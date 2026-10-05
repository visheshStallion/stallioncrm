/**
 * Rich e-mail templates (prompt 20 §B2): the message templates of prompt 10 with an e-mail document (blocks),
 * category, module, folder, a lint before saving, version history and a "used by" list.
 *
 * Who may edit: the brand's manager or an administrator (as before), and the brand's Brand Admin. Group templates:
 * management / administrators. Users only ever see templates of their brands plus group templates (row-level security).
 */
import "server-only";
import { z } from "zod";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as store from "@/server/db/print-store";
import { unsafeUpsertTemplate } from "@/server/db/print-store";
import { BadRequestError } from "@/server/errors";
import { canManageTemplate } from "@/server/modules/messaging/campaigns";
import { MERGE_FIELDS, brokenFields, unknownFields } from "@/server/modules/messaging/merge";
import { imagesWithoutAlt } from "@/server/modules/print/sanitize";
import { EMAIL_CATEGORIES, docSource, renderEmailHtml, renderEmailText, type EmailDoc } from "./blocks";
import { cleanDoc, parseDoc } from "./service";
import { EMAIL_STARTERS, starter } from "./starters";

/** Merge fields a template may use: the record's, the brand's, the sender's, and the system ones. */
export const TEMPLATE_FIELDS = [
  ...MERGE_FIELDS.map((f) => f.field),
  "brand.legalEntity",
  "account.name",
  "quote.number",
  "quote.total",
  "salesOrder.number",
  "salesOrder.total",
  "invoice.number",
  "invoice.total",
  "invoice.dueDate",
  "document.number",
  "user.name",
  "user.email",
  "today",
];

export const canEditTemplate = (ctx: AccessContext, brandId: string | null) => canManageTemplate(ctx, brandId) || (!!brandId && !!ctx.brandAdminOf?.includes(brandId));

const inputSchema = z.object({
  brandId: z.string().min(1).nullable(),
  name: z.string().trim().min(2).max(120),
  module: z.string().trim().max(40).nullable(),
  folder: z.string().trim().max(60).nullable(),
  category: z.enum(EMAIL_CATEGORIES),
  subject: z.string().trim().min(1, "An e-mail template needs a subject").max(200),
  doc: z.unknown(),
  active: z.boolean(),
});
export type RichTemplateInput = z.input<typeof inputSchema>;

export interface Lint {
  errors: string[];
  warnings: string[];
  sizeKb: number;
}

const SAMPLE_BRAND = { code: "BRAND", name: "Brand", legalEntity: "Brand Motors Ltd", address: "1 Sample Road, Lagos", phone: null, website: null, color: "#1565d0", logoUrl: null };

/** Checks before a template is saved. Errors block the save; warnings are shown. */
export function lintTemplate(t: { category: string; subject: string; doc: EmailDoc }): Lint {
  const source = `${t.subject} ${docSource(t.doc)}`;
  const errors: string[] = [];
  const warnings: string[] = [];
  const broken = brokenFields(source);
  if (broken.length) errors.push(`Merge fields that cannot be read: ${broken.slice(0, 5).join(", ")}`);
  const unknown = unknownFields(source, TEMPLATE_FIELDS);
  if (unknown.length) warnings.push(`Unknown merge fields (they print empty unless the record has them): ${unknown.slice(0, 8).join(", ")}`);
  const noAlt = t.doc.blocks.reduce((n, b) => n + (b.type === "text" ? imagesWithoutAlt(b.html) : b.type === "columns" ? imagesWithoutAlt(b.left) + imagesWithoutAlt(b.right) : b.type === "hero" && !b.alt.trim() ? 1 : 0), 0);
  if (noAlt) errors.push(`${noAlt} image(s) have no alternative text`);
  const html = renderEmailHtml(t.doc, { brand: SAMPLE_BRAND, merge: {}, unsubscribeUrl: t.category === "Marketing" ? "https://example.test/unsubscribe" : null });
  const sizeKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
  if (sizeKb > 100) errors.push(`The e-mail is ${sizeKb} KB – mail clients cut messages above about 100 KB. Use smaller images or link to them`);
  // marketing e-mails carry the per-brand unsubscribe link: the layout adds it – check that it really is there
  if (t.category === "Marketing" && !html.includes("Unsubscribe")) errors.push("A marketing template must carry the unsubscribe link");
  if (!t.doc.blocks.some((b) => b.type === "text" || b.type === "columns" || b.type === "vehicle")) warnings.push("The e-mail has no text");
  return { errors, warnings, sizeKb };
}

/** Line-by-line difference of two template versions (text form). */
export function diffText(before: string, after: string): Array<{ kind: "same" | "removed" | "added"; line: string }> {
  const a = before.split("\n"), b = after.split("\n");
  // longest common subsequence, lines only – templates are short
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Array<{ kind: "same" | "removed" | "added"; line: string }> = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", line: a[i++]! });
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "removed", line: a[i++]! });
    else out.push({ kind: "added", line: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "removed", line: a[i++]! });
  while (j < b.length) out.push({ kind: "added", line: b[j++]! });
  return out;
}

const textOf = (subject: string | null, doc: EmailDoc) => `Subject: ${subject ?? ""}\n${renderEmailText(doc, { brand: SAMPLE_BRAND, merge: {} }).split("\n").slice(0, -1).join("\n")}`;

export async function saveRichTemplate(ctx: AccessContext, id: string | null, input: RichTemplateInput) {
  const data = inputSchema.parse(input);
  const db = scopedDb(ctx);
  const existing = id ? await db.template.findUnique({ where: { id } }) : null;
  if (id && (!existing || existing.channel !== "EMAIL")) throw new NotFoundError();
  // the brand of a template never changes
  const brandId = existing ? existing.brandId : data.brandId;
  if (brandId && !ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (!canEditTemplate(ctx, brandId)) throw new ForbiddenError(brandId ? "Only the brand's manager, its Brand Admin or an administrator can change its templates" : "Group templates are managed by management");
  const doc = cleanDoc(data.doc);
  const lint = lintTemplate({ category: data.category, subject: data.subject, doc });
  if (lint.errors.length) throw new BadRequestError(`The template was not saved: ${lint.errors.join("; ")}`);
  // the text form keeps plain-text consumers (SMS-style previews, activity descriptions) working
  const body = renderEmailText(doc, { brand: SAMPLE_BRAND, merge: {} }).split("\n").slice(0, -1).join("\n").trim().slice(0, 4000) || data.name;
  const version = (existing?.version ?? 0) + 1;
  const saved = await unsafeUpsertTemplate(existing?.id ?? null, { brandId, channel: "EMAIL", name: data.name, module: data.module || null, folder: data.folder || null, category: data.category, subject: data.subject, body, blocks: doc as object, active: data.active, version, createdById: existing?.createdById ?? ctx.userId });
  await store.addTemplateVersion({ templateId: saved.id, version, subject: data.subject, body, blocks: doc as object, createdById: ctx.userId });
  await audit({ ctx, action: existing ? "UPDATE" : "CREATE", entity: "Template", entityId: saved.id, brandId, before: existing ? { name: existing.name, subject: existing.subject, version: existing.version, category: existing.category } : undefined, after: { name: saved.name, subject: saved.subject, version, category: saved.category, module: saved.module, blocks: doc.blocks.length } });
  return { id: saved.id, version, lint };
}

export async function richTemplate(ctx: AccessContext, id: string) {
  assertCan(ctx, "campaigns", "read");
  // row-level security: another brand's template is not found
  const t = await scopedDb(ctx).template.findUnique({ where: { id }, include: { brand: { select: { code: true, name: true } } } });
  if (!t || t.channel !== "EMAIL") throw new NotFoundError();
  const [versions, usedBy] = await Promise.all([store.templateVersions(id), store.templateUsage(id)]);
  const doc = parseDoc(t.blocks) ?? { blocks: [{ type: "text" as const, html: t.body.split(/\r?\n\r?\n/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\r?\n/g, "<br>")}</p>`).join("") }] };
  return { ...t, doc, editable: canEditTemplate(ctx, t.brandId), versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, subject: v.subject })), usedBy };
}

export async function templateDiff(ctx: AccessContext, id: string, version: number) {
  const t = await richTemplate(ctx, id);
  const v = await store.templateVersion(id, version);
  if (!v) throw new NotFoundError();
  const old = parseDoc(v.blocks);
  return diffText(old ? textOf(v.subject, old) : `Subject: ${v.subject ?? ""}\n${v.body}`, textOf(t.subject, t.doc));
}

/** Puts an earlier version back (as a new version – the history is never rewritten). */
export async function restoreTemplateVersion(ctx: AccessContext, id: string, version: number) {
  const t = await richTemplate(ctx, id);
  if (!t.editable) throw new ForbiddenError("You cannot change this template");
  const v = await store.templateVersion(id, version);
  if (!v) throw new NotFoundError();
  const doc = parseDoc(v.blocks);
  if (!doc) throw new BadRequestError("This version is a plain-text template and cannot be restored in the rich editor");
  return saveRichTemplate(ctx, id, { brandId: t.brandId, name: t.name, module: t.module, folder: t.folder, category: t.category as (typeof EMAIL_CATEGORIES)[number], subject: v.subject ?? t.subject ?? t.name, doc, active: t.active });
}

/** Brands the user may create templates for (plus "group" when allowed). */
export async function templateBrands(ctx: AccessContext) {
  const rows = await store.brandLetterheadRows(ctx.brandIds);
  return { brands: rows.filter((b) => b.status !== "INACTIVE" && canEditTemplate(ctx, b.id)).sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` })), group: canEditTemplate(ctx, null) };
}

/** Preview of a template in a brand's layout with sample values. */
export async function previewTemplate(ctx: AccessContext, input: { brandId: string | null; category: string; doc: unknown }): Promise<string> {
  assertCan(ctx, "campaigns", "read");
  const doc = cleanDoc(input.doc);
  const { emailBrand } = await import("./service");
  const brand = input.brandId && ctx.brandIds.includes(input.brandId) ? await emailBrand(input.brandId) : SAMPLE_BRAND;
  const sample = { contact: { firstName: "Ada", lastName: "Okafor", name: "Ada Okafor" }, deal: { name: "SUV – Acme Logistics", model: "SUV Premium" }, quote: { number: "Q-2026-00045", total: 32_500_000 }, invoice: { number: "INV-2026-00045", total: 32_500_000 }, salesOrder: { number: "SO-2026-00045" }, account: { name: "Acme Logistics" }, case: { number: "C-00012", subject: "Service booking" }, brand: { name: brand.name, code: brand.code, legalEntity: brand.legalEntity }, owner: { name: ctx.user.name }, user: { name: ctx.user.name, email: ctx.user.email } };
  return renderEmailHtml(doc, { brand, merge: sample, unsubscribeUrl: input.category === "Marketing" ? "#unsubscribe" : null });
}

export { EMAIL_STARTERS, starter };
