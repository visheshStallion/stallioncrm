/**
 * Bulk send (prompt 21 §5.4): the selected documents, each as a PDF with the chosen document template, one e-mail
 * per record to its own customer. A background job that runs as the requester – every record is loaded, rendered and
 * sent with their access at that time, on its own brand's letterhead and from its own brand's sender. The result is
 * a report (CSV under Exports): one line per record with what happened.
 */
import "server-only";
import type { Job } from "@prisma/client";
import { hasPermission } from "@/server/access/can";
import { loadAccessContext } from "@/server/access/context";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { BadRequestError } from "@/server/errors";
import { textDoc } from "@/server/modules/email/blocks";
import { PARENT_INFO, loadEmailRecord, parseDoc, sendEmail, type EmailParent } from "@/server/modules/email/service";
import { notify } from "@/server/modules/notifications/service";
import { printModule } from "@/server/modules/print/modules";
import { loadPrintRecord } from "@/server/modules/print/service";
import { storage } from "@/server/storage";

export const MAX_BULK_SEND = 100;
const EXPIRY_HOURS = 24;

/** modules whose records can be sent as documents → their e-mail parent type */
export const SENDABLE: Record<string, EmailParent> = Object.fromEntries((Object.entries(PARENT_INFO) as Array<[EmailParent, { module: string }]>).filter(([type]) => ["Quote", "SalesOrder", "Invoice", "Deal"].includes(type)).map(([type, info]) => [info.module, type]));

const DEFAULT_SUBJECT = "Your {{record.number | \"document\"}} from {{brand.name}}";
const DEFAULT_TEXT = 'Dear {{contact.firstName | "Customer"}},\n\nPlease find your document attached.\n\nKind regards,\n{{user.name}}\n{{brand.name}}';

export interface BulkSendInput {
  module: string;
  ids: string[];
  /** "default" = each record's brand default; or a document template ("doc:…") / print template id used for all */
  documentTemplate: string;
  /** an e-mail template for subject and text; null = a short standard text */
  emailTemplateId?: string | null;
}

export async function requestBulkSend(ctx: AccessContext, input: BulkSendInput) {
  const parent = SENDABLE[input.module];
  const mod = printModule(input.module);
  if (!parent || !mod) throw new BadRequestError("Records of this module cannot be sent as documents");
  if (!hasPermission(ctx, "campaigns", "massEmail")) throw new ForbiddenError("Sending documents to several customers at once needs the mass e-mail permission");
  const ids = [...new Set(input.ids.filter(Boolean))];
  if (!ids.length) throw new BadRequestError("Select at least one record");
  if (ids.length > MAX_BULK_SEND) throw new BadRequestError(`At most ${MAX_BULK_SEND} documents per job`);
  // the job only ever receives ids the user can open: one hidden record fails the request (404), nothing is skipped silently
  for (const id of ids) await loadPrintRecord(ctx, mod.key, id);
  const job = await scopedDb(ctx).exportJob.create({ data: { userId: ctx.userId, module: `send:${mod.key}`, format: "csv", params: { ids, documentTemplate: input.documentTemplate || "default", emailTemplateId: input.emailTemplateId ?? null }, status: "QUEUED" } });
  await enqueueJob({ type: "document.bulkSend", payload: { exportId: job.id, userId: ctx.userId }, idempotencyKey: `send:${job.id}`, maxAttempts: 1 });
  await audit({ ctx, action: "CREATE", entity: "Email", entityId: null, after: { bulk: true, module: mod.key, records: ids.length, documentTemplate: input.documentTemplate, emailTemplateId: input.emailTemplateId ?? null, queued: job.id } });
  return { jobId: job.id, records: ids.length };
}

/**
 * One record as a document to its own customer: its brand's sender, letterhead and templates, with `ctx`'s current
 * access. Never throws – the outcome is reported.
 */
async function sendOne(ctx: AccessContext, moduleKey: string, parent: EmailParent, id: string, params: { documentTemplate: string; emailTemplateId: string | null }): Promise<{ name: string; to: string; sent: boolean; detail: string }> {
  let name = id;
  let to = "";
  try {
    const record = await loadEmailRecord(ctx, parent, id);
    name = (await loadPrintRecord(ctx, moduleKey, id)).number ?? record.recipient.name;
    to = record.suggestions[0]?.email ?? "";
    if (!to) return { name, to, sent: false, detail: "The customer has no e-mail address" };
    const template = params.emailTemplateId ? await scopedDb(ctx).template.findFirst({ where: { id: params.emailTemplateId, channel: "EMAIL", active: true, OR: [{ brandId: null }, { brandId: record.brandId }] }, select: { id: true, subject: true, body: true, blocks: true } }) : null;
    if (params.emailTemplateId && !template) return { name, to, sent: false, detail: "The e-mail template is not available for this record's brand" };
    const res = await sendEmail(ctx, { parentType: parent, parentId: id, to: [to], subject: template?.subject || DEFAULT_SUBJECT, doc: template ? (parseDoc(template.blocks) ?? textDoc(template.body)) : textDoc(DEFAULT_TEXT), templateId: template?.id ?? null, attachPrint: params.documentTemplate || "default" });
    return { name, to, sent: res.status === "SENT", detail: res.status === "SENT" ? `from ${res.from}` : (res.error ?? "The mail service refused it") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, to, sent: false, detail: /not found/i.test(message) ? "The record or the template is not available to you for this brand" : message.slice(0, 200) };
  }
}

/** Job handler "document.send" (workflow action "Send the document to the customer"): runs as the record's owner. */
export async function runDocumentSend(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const p = job.payload as { module: string; recordId: string; userId: string; documentTemplate: string; emailTemplateId: string | null };
  const parent = SENDABLE[p.module];
  const ctx = await loadAccessContext(p.userId);
  if (!parent || !ctx) return { skipped: !parent ? "module cannot be sent" : "the owner is no longer active" };
  const r = await sendOne(ctx, p.module, parent, p.recordId, p);
  return r.sent ? { sent: r.name, to: r.to } : { notSent: r.detail };
}

const csv = (v: string) => (/[",\r\n]/.test(v) || /^[=+\-@\t]/.test(v) ? `"${(/^[=+\-@\t]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

/** Job handler "document.bulkSend". Never retried as a whole (maxAttempts 1): an e-mail must not go out twice. */
export async function runBulkSend(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { exportId, userId } = job.payload as { exportId: string; userId: string };
  const ctx = await loadAccessContext(userId);
  if (!ctx) return { skipped: "the user is no longer active" };
  const db = scopedDb(ctx);
  const row = await db.exportJob.findUnique({ where: { id: exportId } });
  if (!row || row.status !== "QUEUED") return { skipped: "send job is not queued" };
  const moduleKey = row.module.replace(/^send:/, "");
  const parent = SENDABLE[moduleKey];
  const mod = printModule(moduleKey);
  const params = row.params as { ids: string[]; documentTemplate: string; emailTemplateId: string | null };
  await db.exportJob.update({ where: { id: exportId }, data: { status: "RUNNING" } });
  const lines: string[][] = [["Record", "Recipient", "Result", "Detail"]];
  let sent = 0;
  try {
    if (!parent || !mod) throw new Error("Unknown module");
    if (!hasPermission(ctx, "campaigns", "massEmail")) throw new Error("The mass e-mail permission was removed");
    for (const id of params.ids) {
      const r = await sendOne(ctx, moduleKey, parent, id, params);
      if (r.sent) sent++;
      lines.push([r.name, r.to, r.sent ? "Sent" : "Not sent", r.detail]);
    }
    const storageKey = `exports/${userId}/${exportId}.csv`;
    await storage().put(storageKey, new TextEncoder().encode(`${String.fromCharCode(0xfeff)}${lines.map((l) => l.map(csv).join(",")).join("\r\n")}\r\n`), "text/csv");
    await db.exportJob.update({ where: { id: exportId }, data: { status: "DONE", rowCount: params.ids.length, storageKey, fileName: `Sent-${mod.plural.replace(/\s+/g, "-")}-${params.ids.length}.csv`, finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPIRY_HOURS * 3_600_000) } });
    await notify(ctx, [userId], { kind: "INFO", title: `${sent} of ${params.ids.length} ${mod.plural.toLowerCase()} sent`, body: sent === params.ids.length ? "Every customer received their document." : "Open the report to see which were not sent, and why.", href: "/exports" });
    return { records: params.ids.length, sent };
  } catch (err) {
    await db.exportJob.update({ where: { id: exportId }, data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
}
