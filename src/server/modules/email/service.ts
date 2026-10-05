/**
 * E-mail composer (prompt 20 Part B1): rich e-mail from any record, in the brand's layout.
 *
 *   • From = the record's brand sender identity – never chosen freely. For shared records (contacts, accounts) the
 *     user picks one of THEIR brands; a brand they cannot access is a 404.
 *   • Merge fields are resolved from the record as the SENDER sees it (scoped client, field mask) – a template can
 *     never pull another brand's data.
 *   • Bodies are sanitised (no scripts, iframes, forms, event handlers), wrapped in the brand layout, and logged as
 *     an Activity + Message on the record (brand-owned). Every send is audited.
 */
import "server-only";
import { z } from "zod";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { fieldMaskView } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { consentFor, defaultInboundRegion } from "@/server/db/messaging-system";
import * as store from "@/server/db/print-store";
import { BadRequestError } from "@/server/errors";
import { isValidEmail, renderMerge, type MergeData } from "@/server/modules/messaging/merge";
import type { OutboundMessage } from "@/server/modules/messaging/providers";
import { deliver, loadMessageRecord, type MessageRecord } from "@/server/modules/messaging/service";
import { MAX_HTML, cleanHtml } from "@/server/modules/print/sanitize";
import { storage } from "@/server/storage";
import { docSource, renderEmailHtml, renderEmailText, textDoc, type EmailBlock, type EmailBrand, type EmailDoc } from "./blocks";

type Inline = NonNullable<OutboundMessage["attachments"]>;

export const EMAIL_PARENTS = ["Lead", "Deal", "Case", "Contact", "Account", "Quote", "SalesOrder", "Invoice"] as const;
export type EmailParent = (typeof EMAIL_PARENTS)[number];

/** parent type → module key (templates, print) and the record's page */
export const PARENT_INFO: Record<EmailParent, { module: string; path: string; label: string }> = {
  Lead: { module: "leads", path: "/leads", label: "Lead" },
  Deal: { module: "deals", path: "/deals", label: "Deal" },
  Case: { module: "cases", path: "/cases", label: "Case" },
  Contact: { module: "contacts", path: "/contacts", label: "Contact" },
  Account: { module: "accounts", path: "/accounts", label: "Account" },
  Quote: { module: "quotes", path: "/quotes", label: "Quotation" },
  SalesOrder: { module: "salesOrders", path: "/salesOrders", label: "Sales Order" },
  Invoice: { module: "invoices", path: "/invoices", label: "Invoice" },
};

export const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const appUrl = () => (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "");

// ───────────────────────────── the record ─────────────────────────────

/** A region the sender can write to in the brand (shared records have none of their own). */
async function regionFor(ctx: AccessContext, brandId: string): Promise<string> {
  const own = ctx.memberships.find((m) => m.brandId === brandId && m.regionId)?.regionId;
  const regionId = own ?? (await defaultInboundRegion());
  if (!regionId) throw new BadRequestError("No region is available for this brand");
  return regionId;
}

/**
 * The record an e-mail is about, loaded with the sender's access (404 when hidden), with its customer and merge
 * data. `brandId` is only used for shared records and must be one of the sender's brands.
 */
export async function loadEmailRecord(ctx: AccessContext, parentType: string, parentId: string, brandId?: string | null): Promise<MessageRecord & { suggestions: Array<{ name: string; email: string }> }> {
  if (!(EMAIL_PARENTS as readonly string[]).includes(parentType)) throw new BadRequestError("E-mails cannot be sent from this kind of record");
  const db = scopedDb(ctx);
  const brandOf = async (id: string) => {
    const b = await db.brand.findUnique({ where: { id }, select: { name: true, code: true } });
    if (!b) throw new NotFoundError();
    return b;
  };
  const suggest = (list: Array<{ name: string; email: string | null | undefined }>) => {
    const seen = new Set<string>();
    return list.filter((x): x is { name: string; email: string } => !!x.email && isValidEmail(x.email) && !seen.has(x.email.toLowerCase()) && !!seen.add(x.email.toLowerCase()));
  };

  if (parentType === "Lead" || parentType === "Deal" || parentType === "Case") {
    const record = await loadMessageRecord(ctx, parentType, parentId);
    return { ...record, suggestions: suggest([{ name: record.recipient.name, email: record.recipient.email }]) };
  }

  if (parentType === "Quote" || parentType === "SalesOrder" || parentType === "Invoice") {
    const type = parentType === "Quote" ? "quote" : parentType === "SalesOrder" ? "salesOrder" : "invoice";
    const moduleKey = PARENT_INFO[parentType].module as "quotes" | "salesOrders" | "invoices";
    const doc = fieldMaskView(ctx, moduleKey, await (await import("@/server/modules/documents/queries")).getDocument(ctx, type, parentId)) as unknown as Record<string, unknown> & { brandId: string; regionId: string; ownerId: string; number: string; accountId: string | null; contactId: string | null; customerName: string | null; total?: number };
    const [brand, contact, account, owner] = await Promise.all([
      brandOf(doc.brandId),
      doc.contactId ? db.contact.findUnique({ where: { id: doc.contactId }, select: { id: true, firstName: true, lastName: true, email: true, mobile: true } }) : null,
      doc.accountId ? db.account.findUnique({ where: { id: doc.accountId }, select: { name: true, email: true, phone: true } }) : null,
      db.user.findUnique({ where: { id: doc.ownerId }, select: { name: true } }),
    ]);
    const name = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : (account?.name ?? doc.customerName ?? "");
    const scalars = Object.fromEntries(Object.entries(doc).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))) as Record<string, string | number | boolean | null>;
    const group = parentType === "Quote" ? "quote" : parentType === "SalesOrder" ? "salesOrder" : "invoice";
    return {
      parentType,
      parentId,
      brandId: doc.brandId,
      regionId: doc.regionId,
      ownerId: doc.ownerId,
      recipient: { name, firstName: contact?.firstName ?? null, lastName: contact?.lastName ?? null, mobile: contact?.mobile ?? account?.phone ?? null, email: contact?.email ?? account?.email ?? null, contactId: contact?.id ?? null, leadId: null },
      merge: { contact: { firstName: contact?.firstName ?? name, lastName: contact?.lastName, name }, account: { name: account?.name ?? doc.customerName }, [group]: scalars, document: scalars, brand, owner: { name: owner?.name } },
      suggestions: suggest([{ name, email: contact?.email }, { name: account?.name ?? "", email: account?.email }]),
    };
  }

  // shared records: the sender chooses one of their own brands
  if (!brandId) throw new BadRequestError("Choose the brand to send as");
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const brand = await brandOf(brandId);
  const regionId = await regionFor(ctx, brandId);
  const customers = await import("@/server/modules/customers/queries");
  if (parentType === "Contact") {
    const c = fieldMaskView(ctx, "contacts", await customers.getContact(ctx, parentId));
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name;
    return {
      parentType,
      parentId,
      brandId,
      regionId,
      ownerId: ctx.userId,
      recipient: { name, firstName: c.firstName, lastName: (c as { lastName?: string | null }).lastName ?? null, mobile: c.mobile, email: c.email, contactId: c.id, leadId: null },
      merge: { contact: { firstName: c.firstName ?? name, lastName: (c as { lastName?: string | null }).lastName, name }, brand, owner: { name: ctx.user.name } },
      suggestions: suggest([{ name, email: c.email }]),
    };
  }
  const a = fieldMaskView(ctx, "accounts", await customers.getAccount(ctx, parentId));
  const contacts = await db.contact.findMany({ where: { accountId: parentId }, select: { firstName: true, lastName: true, email: true }, take: 20 });
  return {
    parentType: "Account",
    parentId,
    brandId,
    regionId,
    ownerId: ctx.userId,
    recipient: { name: a.name, firstName: null, lastName: null, mobile: a.phone, email: a.email, contactId: null, leadId: null },
    merge: { contact: { firstName: a.name, name: a.name }, account: { name: a.name }, brand, owner: { name: ctx.user.name } },
    suggestions: suggest([{ name: a.name, email: a.email }, ...contacts.map((c) => ({ name: [c.firstName, c.lastName].filter(Boolean).join(" "), email: c.email }))]),
  };
}

// ───────────────────────────── brand layout ─────────────────────────────

/** The brand as e-mails show it. The logo is served by the application (mail clients do not show embedded data: images). */
export async function emailBrand(brandId: string): Promise<EmailBrand> {
  const row = (await store.brandLetterheadRows([brandId]))[0];
  if (!row) throw new NotFoundError();
  const base = appUrl();
  return { code: row.code, name: row.name, legalEntity: row.legalEntity || row.name, address: row.address, phone: row.phone, website: row.website, color: row.color ?? "#1565d0", logoUrl: row.logoMimeType && /^https:/i.test(base) ? `${base}/api/public/brands/${row.id}/logo` : null };
}

// ───────────────────────────── documents ─────────────────────────────

const url = z.string().trim().max(2000);
const blockSchema: z.ZodType<EmailBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), html: z.string().max(MAX_HTML) }),
  z.object({ type: z.literal("hero"), url: z.string().max(400_000), alt: z.string().trim().max(160), href: url.optional() }),
  z.object({ type: z.literal("columns"), left: z.string().max(MAX_HTML), right: z.string().max(MAX_HTML) }),
  z.object({ type: z.literal("vehicle"), image: z.string().max(400_000).optional(), model: z.string().trim().max(160), price: z.string().trim().max(80), description: z.string().trim().max(500).optional(), cta: z.string().trim().max(60), href: url }),
  z.object({ type: z.literal("button"), label: z.string().trim().min(1).max(60), href: url }),
  z.object({ type: z.literal("divider") }),
  z.object({ type: z.literal("spacer"), height: z.number().min(4).max(80) }),
  z.object({ type: z.literal("social"), links: z.array(z.object({ label: z.string().trim().min(1).max(40), href: url })).max(8) }),
]);
const docSchema = z.object({ blocks: z.array(blockSchema).min(1).max(40) });

const IMAGE = /^(https:\/\/[^\s"'<>]+|data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)$/;
const LINK = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+0-9 ()-]+|\{\{[^{}]+\}\})$/;

/** Validates an e-mail document and sanitises every piece of HTML in it. */
export function cleanDoc(raw: unknown): EmailDoc {
  const doc = docSchema.parse(raw);
  const link = (href: string | undefined, what: string) => {
    if (href && !LINK.test(href)) throw new BadRequestError(`${what}: a link must start with https://, http://, mailto: or tel:`);
    return href;
  };
  const image = (src: string | undefined, what: string) => {
    if (src && !IMAGE.test(src)) throw new BadRequestError(`${what}: upload the image or give an https address`);
    return src;
  };
  return {
    blocks: doc.blocks.map((b): EmailBlock => {
      switch (b.type) {
        case "text":
          return { ...b, html: cleanHtml(b.html) };
        case "columns":
          return { ...b, left: cleanHtml(b.left), right: cleanHtml(b.right) };
        case "hero":
          if (!b.alt) throw new BadRequestError("The hero image needs alternative text");
          return { ...b, url: image(b.url, "Hero image")!, href: link(b.href, "Hero image") };
        case "vehicle":
          return { ...b, image: image(b.image, "Vehicle card"), href: link(b.href, "Vehicle card")! };
        case "button":
          return { ...b, href: link(b.href, "Button")! };
        case "social":
          return { ...b, links: b.links.map((l) => ({ ...l, href: link(l.href, "Social link")! })) };
        default:
          return b;
      }
    }),
  };
}

/** A stored document; null when the template is a plain-text one or the stored value is not readable. */
export function parseDoc(raw: unknown): EmailDoc | null {
  const parsed = docSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Embedded images (data: URIs) become inline attachments referenced by cid: – mail clients do not show data: images. */
export function inlineImages(html: string): { html: string; inline: Inline } {
  const inline: Inline = [];
  const seen = new Map<string, string>();
  const out = html.replace(/src="(data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+))"/g, (_m, whole: string, type: string, b64: string) => {
    let cid = seen.get(whole);
    if (!cid) {
      cid = `img${inline.length + 1}@stallioncrm`;
      seen.set(whole, cid);
      const ext = type === "jpeg" ? "jpg" : type;
      inline.push({ filename: `image-${inline.length + 1}.${ext}`, contentType: `image/${type === "jpg" ? "jpeg" : type}`, content: new Uint8Array(Buffer.from(b64, "base64")), cid });
    }
    return `src="cid:${cid}"`;
  });
  return { html: out, inline };
}

/** Used by deliver(): a template with blocks rendered for one record in its brand's layout; null for plain-text templates. */
export async function renderTemplateForRecord(templateId: string, record: MessageRecord, unsubscribeUrl: string | null): Promise<{ html: string; inline: Inline } | null> {
  const t = await store.templateForRender(templateId);
  const doc = t ? parseDoc(t.blocks) : null;
  // a template of another brand is never rendered for this record
  if (!t || !doc || (t.brandId !== null && t.brandId !== record.brandId)) return null;
  const html = renderEmailHtml(doc, { brand: await emailBrand(record.brandId), merge: record.merge, unsubscribeUrl });
  return inlineImages(html);
}

// ───────────────────────────── composer ─────────────────────────────

const addresses = z.array(z.string().trim().toLowerCase()).max(10).default([]);
const sendSchema = z.object({
  parentType: z.enum(EMAIL_PARENTS),
  parentId: z.string().min(1),
  brandId: z.string().min(1).nullish(),
  to: z.array(z.string().trim().toLowerCase()).min(1, "Add at least one recipient").max(10),
  cc: addresses,
  bcc: addresses,
  subject: z.string().trim().min(1, "Write a subject").max(200),
  doc: z.unknown(),
  templateId: z.string().min(1).nullish(),
  includeSignature: z.boolean().default(true),
  /** attach the record as a PDF printout: a print template id, "default" for the brand's default, or null */
  attachPrint: z.string().min(1).nullish(),
  /** attachments of the record (documents uploaded on it) */
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
  /** create a follow-up task in this many days; null = none */
  followUpDays: z.number().int().min(0).max(90).nullish(),
});
export type SendEmailInput = z.input<typeof sendSchema>;

export interface Upload {
  name: string;
  type: string;
  bytes: Uint8Array;
}

interface Built {
  record: Awaited<ReturnType<typeof loadEmailRecord>>;
  subject: string;
  html: string;
  text: string;
  inline: Inline;
  templateId: string | null;
  marketing: boolean;
  data: z.output<typeof sendSchema>;
}

/** Everything up to the point of sending: record, template check, merge, sanitise, brand layout. */
async function build(ctx: AccessContext, input: unknown): Promise<Built> {
  const data = sendSchema.parse(input);
  for (const a of [...data.to, ...data.cc, ...data.bcc]) if (!isValidEmail(a)) throw new BadRequestError(`"${a}" is not a valid e-mail address`);
  const record = await loadEmailRecord(ctx, data.parentType, data.parentId, data.brandId);
  assertCan(ctx, "activities", "create", record);
  const db = scopedDb(ctx);
  // only templates of the record's brand, or group templates
  const template = data.templateId ? await db.template.findFirst({ where: { id: data.templateId, channel: "EMAIL", active: true, OR: [{ brandId: null }, { brandId: record.brandId }] }, select: { id: true, category: true } }) : null;
  if (data.templateId && !template) throw new BadRequestError("This template is not available for the record's brand");
  const marketing = template?.category === "Marketing";
  if (marketing) {
    // per-brand marketing consent (prompts 03 / 10): a customer who opted out of THIS brand gets no marketing e-mail from it
    const consent = await consentFor(record.brandId, { contactId: record.recipient.contactId, leadId: record.recipient.leadId });
    if (consent === false) throw new ForbiddenError("The customer opted out of this brand's marketing – a marketing template cannot be sent to them");
  }
  const doc = cleanDoc(data.doc);
  const brand = await emailBrand(record.brandId);
  const merge: MergeData = { ...record.merge, brand: { ...record.merge.brand, name: brand.name, code: brand.code, legalEntity: brand.legalEntity }, user: { name: ctx.user.name, email: ctx.user.email } };
  const signature = data.includeSignature ? ((await store.signatureOf(ctx.userId, record.brandId))?.html ?? null) : null;
  const options = { brand, merge, signatureHtml: signature };
  const rendered = inlineImages(renderEmailHtml(doc, options));
  if (rendered.html.length > 500_000) throw new BadRequestError("The e-mail is larger than 500 KB – remove some content or images");
  return { record, subject: renderMerge(data.subject, merge).slice(0, 200), html: rendered.html, text: renderEmailText(doc, options), inline: rendered.inline, templateId: template?.id ?? null, marketing, data };
}

/** Desktop / mobile preview: the e-mail exactly as it would be sent, merge fields resolved for this record. */
export async function previewEmail(ctx: AccessContext, input: unknown): Promise<{ subject: string; html: string }> {
  const built = await build(ctx, input);
  // the preview shows embedded images directly (cid: only exists inside a mail client)
  const html = built.inline.reduce((h, a) => h.replaceAll(`cid:${a.cid}`, `data:${a.contentType};base64,${Buffer.from(a.content).toString("base64")}`), built.html);
  return { subject: built.subject, html };
}

async function gatherAttachments(ctx: AccessContext, built: Built, uploads: Upload[]): Promise<{ files: Inline; printTemplate: string | null }> {
  const files: Inline = [];
  let size = 0;
  const add = (filename: string, contentType: string, content: Uint8Array) => {
    size += content.byteLength;
    if (size > MAX_ATTACH_BYTES) throw new BadRequestError("The attachments are larger than 10 MB in total");
    files.push({ filename: filename.replace(/[\r\n"\\/]/g, "_").slice(0, 120), contentType, content });
  };
  for (const u of uploads.slice(0, 10)) add(u.name, u.type || "application/octet-stream", u.bytes);
  if (built.data.attachmentIds.length) {
    // documents uploaded on THIS record only, through the scoped client
    const rows = await scopedDb(ctx).attachment.findMany({ where: { id: { in: built.data.attachmentIds }, entity: built.record.parentType, entityId: built.record.parentId } });
    if (rows.length !== new Set(built.data.attachmentIds).size) throw new NotFoundError();
    for (const r of rows) add(r.fileName, r.contentType, await storage().get(r.storageKey));
  }
  let printTemplate: string | null = null;
  if (built.data.attachPrint) {
    const { renderPrintPdf } = await import("@/server/modules/print/service");
    const moduleKey = PARENT_INFO[built.record.parentType as EmailParent].module;
    const pdf = await renderPrintPdf(ctx, { module: moduleKey, recordIds: [built.record.parentId], templateId: built.data.attachPrint === "default" ? null : built.data.attachPrint, companyBrandId: built.record.brandId, via: "email" });
    add(pdf.fileName, "application/pdf", pdf.bytes);
    printTemplate = built.data.attachPrint;
  }
  return { files, printTemplate };
}

/** Sends the e-mail: logged on the record (Activity + Message), audited, optional follow-up task. */
export async function sendEmail(ctx: AccessContext, input: unknown, uploads: Upload[] = []) {
  const built = await build(ctx, input);
  const { files, printTemplate } = await gatherAttachments(ctx, built, uploads);
  const [first, ...moreTo] = built.data.to;
  const res = await deliver(ctx, {
    channel: "EMAIL",
    record: built.record,
    to: first,
    subject: built.subject,
    body: built.text,
    html: built.html,
    cc: [...moreTo, ...built.data.cc],
    bcc: built.data.bcc,
    replyTo: isValidEmail(ctx.user.email) ? ctx.user.email : null,
    attachments: [...built.inline, ...files],
    templateId: built.templateId,
  });
  await audit({ ctx, action: "CREATE", entity: "Email", entityId: res.id, brandId: built.record.brandId, after: { status: res.status, from: res.from, to: built.data.to, cc: built.data.cc.length, bcc: built.data.bcc.length, record: `${built.record.parentType}:${built.record.parentId}`, templateId: built.templateId, marketing: built.marketing, attachments: files.map((f) => f.filename), printTemplate, error: res.error } });
  let taskId: string | null = null;
  if (res.status === "SENT" && built.data.followUpDays !== null && built.data.followUpDays !== undefined) {
    const due = new Date(Date.now() + built.data.followUpDays * 86_400_000);
    const task = await scopedDb(ctx).activity.create({ data: { type: "TASK", status: "OPEN", subject: `Follow up: ${built.subject}`.slice(0, 200), dueAt: due, parentType: built.record.parentType, parentId: built.record.parentId, brandId: built.record.brandId, regionId: built.record.regionId, ownerId: ctx.userId }, select: { id: true } });
    taskId = task.id;
  }
  return { ...res, taskId, attachments: files.length };
}

/** "Send test": the e-mail to the sender's own address – not logged on the record, not sent to the customer. */
export async function sendTestEmail(ctx: AccessContext, input: unknown): Promise<string> {
  const built = await build(ctx, input);
  if (!isValidEmail(ctx.user.email)) throw new BadRequestError("Your account has no valid e-mail address to send the test to");
  const { providerFor } = await import("@/server/modules/messaging/providers");
  const { senderIdentity } = await import("@/server/modules/messaging/service");
  const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: built.record.brandId }, select: { id: true, code: true, name: true, fromName: true, fromEmail: true, smsSenderId: true, whatsappNumber: true, whatsappPhoneId: true } });
  await providerFor("EMAIL").send({ channel: "EMAIL", from: senderIdentity(brand, "EMAIL"), to: ctx.user.email, subject: `[Test] ${built.subject}`, text: built.text, html: built.html, attachments: built.inline });
  await audit({ ctx, action: "CREATE", entity: "Email", entityId: null, brandId: built.record.brandId, after: { test: true, to: ctx.user.email, record: `${built.record.parentType}:${built.record.parentId}` } });
  return ctx.user.email;
}

// ───────────────────────────── drafts & scheduled sends ─────────────────────────────

/** Saves the composer's state. With `sendAt` the e-mail is sent at that time by the job queue, with the user's access then. */
export async function saveDraft(ctx: AccessContext, id: string | null, input: unknown, sendAt: Date | null) {
  const built = await build(ctx, input); // validates everything a send would validate
  if (sendAt && sendAt.getTime() < Date.now() + 60_000) throw new BadRequestError("Choose a time at least a minute from now");
  if (sendAt && sendAt.getTime() > Date.now() + 90 * 86_400_000) throw new BadRequestError("An e-mail can be scheduled at most 90 days ahead");
  const payload = { ...built.data, doc: cleanDoc(built.data.doc) } as object;
  const status = sendAt ? "SCHEDULED" : "DRAFT";
  let draftId = id;
  if (id) {
    const res = await store.updateDraft(id, ctx.userId, { payload, status, sendAt, error: null, brandId: built.record.brandId });
    if (res.count !== 1) throw new NotFoundError();
  } else draftId = (await store.createDraft({ userId: ctx.userId, parentType: built.record.parentType, parentId: built.record.parentId, brandId: built.record.brandId, payload, status, sendAt })).id;
  if (sendAt) await enqueueJob({ type: "email.scheduled", payload: { draftId, userId: ctx.userId, sendAt: sendAt.toISOString() }, runAt: sendAt, idempotencyKey: `email:${draftId}:${sendAt.getTime()}`, maxAttempts: 2 });
  await audit({ ctx, action: id ? "UPDATE" : "CREATE", entity: "EmailDraft", entityId: draftId, brandId: built.record.brandId, after: { status, sendAt, record: `${built.record.parentType}:${built.record.parentId}` } });
  return { id: draftId!, status };
}

export async function myDrafts(ctx: AccessContext, parentType: string, parentId: string) {
  return (await store.draftsOf(ctx.userId, parentType, parentId)).map((d) => ({ id: d.id, status: d.status, sendAt: d.sendAt, error: d.error, updatedAt: d.updatedAt, payload: d.payload as Record<string, unknown> }));
}

export async function discardDraft(ctx: AccessContext, id: string) {
  const res = await store.updateDraft(id, ctx.userId, { status: "CANCELLED" });
  if (res.count !== 1) throw new NotFoundError();
}

/** Job handler "email.scheduled": sends a scheduled draft as its author – if they may still see the record. */
export async function runScheduledEmail(job: { payload: unknown }): Promise<Record<string, unknown>> {
  const { draftId, userId, sendAt } = job.payload as { draftId: string; userId: string; sendAt: string };
  const draft = await store.draftOf(draftId);
  // rescheduled or cancelled drafts leave their old jobs behind: only the job of the current time sends
  if (!draft || draft.userId !== userId || draft.status !== "SCHEDULED" || draft.sendAt?.toISOString() !== sendAt) return { skipped: "not scheduled for this time any more" };
  if (!(await store.claimScheduledDraft(draftId))) return { skipped: "already taken" };
  const { loadAccessContext } = await import("@/server/access/context");
  const ctx = await loadAccessContext(userId);
  try {
    if (!ctx) throw new Error("The sender is no longer active");
    const res = await sendEmail(ctx, draft.payload);
    if (res.status !== "SENT") throw new Error(res.error ?? "The e-mail could not be sent");
    await store.updateDraft(draftId, userId, { status: "SENT", error: null });
    return { sent: res.id };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await store.updateDraft(draftId, userId, { status: "FAILED", error });
    if (ctx) {
      const { notify } = await import("@/server/modules/notifications/service");
      await notify(ctx, [userId], { kind: "INFO", title: "A scheduled e-mail was not sent", body: error, href: `${PARENT_INFO[draft.parentType as EmailParent]?.path ?? ""}/${draft.parentId}` });
    }
    return { failed: error };
  }
}

// ───────────────────────────── signatures ─────────────────────────────

export async function mySignatures(ctx: AccessContext) {
  const [rows, brands] = await Promise.all([store.signaturesOf(ctx.userId), store.brandLetterheadRows(ctx.brandIds)]);
  return brands.filter((b) => b.status !== "INACTIVE").sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ brandId: b.id, code: b.code, name: b.name, html: rows.find((r) => r.brandId === b.id)?.html ?? "" }));
}

/** A user's own signature for one of their brands (sanitised; an empty text removes it). */
export async function saveSignature(ctx: AccessContext, brandId: string, html: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (html.length > 20_000) throw new BadRequestError("The signature is too long");
  const clean = cleanHtml(html);
  if (!clean.replace(/<[^>]+>/g, "").trim() && !/<img/i.test(clean)) await store.deleteSignature(ctx.userId, brandId);
  else await store.saveSignature(ctx.userId, brandId, clean);
}

// ───────────────────────────── what the composer page needs ─────────────────────────────

export async function composerData(ctx: AccessContext, parentType: string, parentId: string, brandId?: string | null) {
  const shared = parentType === "Contact" || parentType === "Account";
  const brands = shared ? (await store.brandLetterheadRows(ctx.brandIds)).filter((b) => b.status !== "INACTIVE" && b.fromEmail).sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` })) : [];
  const chosen = shared ? (brandId && brands.some((b) => b.id === brandId) ? brandId : (brands[0]?.id ?? null)) : null;
  if (shared && !chosen) throw new BadRequestError("None of your brands has an e-mail sender configured (Setup → Brands)");
  const record = await loadEmailRecord(ctx, parentType, parentId, chosen);
  assertCan(ctx, "activities", "create", record);
  const info = PARENT_INFO[record.parentType as EmailParent];
  const db = scopedDb(ctx);
  const [brand, templates, signature, attachments, drafts, printTemplates] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: record.brandId }, select: { code: true, name: true, fromName: true, fromEmail: true } }),
    db.template.findMany({ where: { channel: "EMAIL", active: true, AND: [{ OR: [{ brandId: null }, { brandId: record.brandId }] }, { OR: [{ module: null }, { module: info.module }] }] }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, subject: true, body: true, blocks: true, category: true, brandId: true } }),
    store.signatureOf(ctx.userId, record.brandId),
    db.attachment.findMany({ where: { entity: record.parentType, entityId: record.parentId }, select: { id: true, fileName: true, size: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    myDrafts(ctx, record.parentType, record.parentId),
    hasPermission(ctx, "activities", "create") ? db.printTemplate.findMany({ where: { module: info.module, active: true, OR: [{ brandId: null }, { brandId: record.brandId }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const mergeFields = Object.entries(record.merge).flatMap(([group, values]) => Object.keys(values ?? {}).map((k) => `${group}.${k}`)).filter((f) => !f.startsWith("document.")).sort();
  return {
    record: { parentType: record.parentType, parentId: record.parentId, brandId: record.brandId, name: record.recipient.name, label: info.label, path: `${info.path}/${record.parentId}` },
    from: brand.fromEmail ? `${brand.fromName || brand.name} <${brand.fromEmail}>` : null,
    brandLabel: `${brand.code} – ${brand.name}`,
    brands,
    suggestions: record.suggestions,
    templates: templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject ?? "", category: t.category, group: t.brandId === null, doc: parseDoc(t.blocks) ?? textDoc(t.body) })),
    hasSignature: !!signature,
    attachments,
    drafts,
    printTemplates,
    mergeFields: [...new Set([...mergeFields, "user.name", "today"])],
  };
}

export { docSource };
