/**
 * Document templates (prompt 21): who may create, change, approve, publish and use a template, and the stored copies
 * of generated documents.
 *
 *   PERSONAL      only its author uses it; any brand of the author ("all my brands") or one of them. Not allowed for
 *                 official financial documents (invoices, sales orders, inventory documents).
 *   SHARED_BRAND  one brand. Written by the brand's manager, its Brand Admin or an administrator; published by the
 *                 Brand Admin or an administrator – a brand manager submits it for approval (approval engine).
 *   GROUP         every brand; administrators only. Renders the RECORD's brand letterhead.
 *
 * A template never decides whose letterhead or whose data is printed: the print engine loads the record with the
 * user's access and takes the letterhead of the record's brand. A template of another brand does not exist (404).
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { managedBrands } from "@/server/access/brand-tag";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import * as store from "@/server/db/doc-template-store";
import { defaultInboundRegion } from "@/server/db/messaging-system";
import { BadRequestError } from "@/server/errors";
import { brokenFields, unknownFields } from "@/server/modules/messaging/merge";
import type { Letterhead, Margins, Orientation, Paper, PrintLayout } from "@/server/modules/print/blocks";
import type { PrintRecord } from "@/server/modules/print/describe";
import { printModule } from "@/server/modules/print/modules";
import { MAX_HTML, cleanHtml } from "@/server/modules/print/sanitize";
import { storage } from "@/server/storage";
import { CONDITION_OPS, DEFAULT_MARGINS, FINANCIAL_MODULES, PAPERS, VISIBILITIES, cleanCss, compileDoc, contentSource, emptyContent, sheetCss, type DocBlock, type DocContent, type TemplateStatus, type Visibility } from "./content";
import { docStarter } from "./starters";

type Row = Awaited<ReturnType<typeof store.docTemplates>>[number];

// ───────────────────────────── who may do what ─────────────────────────────

const isBrandAdmin = (ctx: AccessContext, brandId: string) => !!ctx.isAdmin || !!ctx.brandAdminOf?.includes(brandId);
const isBrandManager = (ctx: AccessContext, brandId: string) => managedBrands(ctx).includes(brandId);
type Scope = Pick<Row, "visibility" | "brandId" | "createdById" | "status">;

/** Publishing, defaults and archiving: the author of a personal template; Brand Admin / administrator for shared ones. */
export function canPublish(ctx: AccessContext, t: Scope): boolean {
  if (t.visibility === "PERSONAL") return t.createdById === ctx.userId;
  if (t.visibility === "GROUP") return !!ctx.isAdmin;
  return !!t.brandId && ctx.brandIds.includes(t.brandId) && isBrandAdmin(ctx, t.brandId);
}

export function canEdit(ctx: AccessContext, t: Scope): boolean {
  if (canPublish(ctx, t)) return true;
  return t.visibility === "SHARED_BRAND" && !!t.brandId && ctx.brandIds.includes(t.brandId) && isBrandManager(ctx, t.brandId);
}

/** Listed for the user: their own, the published ones of their brands and of the group, and what they may edit. */
export function canSee(ctx: AccessContext, t: Scope): boolean {
  if (t.createdById === ctx.userId) return true;
  if (t.visibility === "PERSONAL") return false;
  if (t.brandId && !ctx.brandIds.includes(t.brandId)) return false;
  return t.status === "PUBLISHED" || canEdit(ctx, t);
}

/** May the user generate documents of this record with the template? */
function usable(ctx: AccessContext, t: Row, record: Pick<PrintRecord, "module" | "brandId">): boolean {
  if (t.module !== record.module || t.published === null || t.status === "ARCHIVED") return false;
  if (t.visibility === "PERSONAL" && (t.createdById !== ctx.userId || FINANCIAL_MODULES.includes(t.module))) return false;
  if (t.brandId) return ctx.brandIds.includes(t.brandId) && (record.brandId === null || record.brandId === t.brandId);
  return true;
}

// ───────────────────────────── content ─────────────────────────────

const html = z.string().max(MAX_HTML);
const blockSchema: z.ZodType<DocBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rich"), html }),
  z.object({ type: z.literal("title"), text: z.string().max(200), showNumber: z.boolean(), showDates: z.boolean() }),
  z.object({ type: z.literal("parties"), shipTo: z.boolean() }),
  z.object({ type: z.literal("fields"), title: z.string().max(80).optional(), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]), fields: z.array(z.string().max(80)).max(80) }),
  z.object({ type: z.literal("lineItems"), title: z.string().max(80).optional(), columns: z.array(z.string().max(40)).max(12), zebra: z.boolean() }),
  z.object({ type: z.literal("totals"), words: z.boolean() }),
  z.object({ type: z.literal("payment"), terms: z.string().max(1000).optional() }),
  z.object({ type: z.literal("vehicle") }),
  z.object({ type: z.literal("terms"), html: html.optional() }),
  z.object({ type: z.literal("signatures"), roles: z.array(z.string().trim().min(1).max(60)).max(4), stamp: z.boolean() }),
  z.object({ type: z.literal("qr"), value: z.enum(["url", "vin", "number"]) }),
  z.object({ type: z.literal("barcode"), value: z.enum(["vin", "number"]) }),
  z.object({ type: z.literal("conditional"), field: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?$/, "Choose a field for the condition"), op: z.enum(CONDITION_OPS), value: z.string().max(120), html }),
  z.object({ type: z.literal("repeat"), list: z.string().min(1).max(60), title: z.string().max(80).optional(), html }),
  z.object({ type: z.literal("related"), list: z.string().min(1).max(60), title: z.string().max(80).optional() }),
  z.object({ type: z.literal("pageBreak") }),
]);
const contentSchema = z.object({
  letterhead: z.object({ show: z.boolean(), logo: z.enum(["left", "center", "right"]), details: z.enum(["beside", "below"]) }),
  header: html,
  body: z.array(blockSchema).min(1, "The template needs at least one block").max(60),
  footer: html,
});
const marginsSchema = z.object({ top: z.number().min(5).max(50), right: z.number().min(5).max(50), bottom: z.number().min(5).max(50), left: z.number().min(5).max(50) });

/**
 * Validates a template's content and sanitises every piece of HTML in it (no scripts, iframes, forms, event handlers;
 * images only embedded or from https). The record's amounts never come from here.
 */
export function cleanContent(raw: unknown): DocContent {
  const c = contentSchema.parse(raw);
  return {
    letterhead: c.letterhead,
    header: cleanHtml(c.header),
    footer: cleanHtml(c.footer),
    body: c.body.map((b): DocBlock => (b.type === "rich" || b.type === "conditional" || b.type === "repeat" ? { ...b, html: cleanHtml(b.html) } : b.type === "terms" && b.html ? { ...b, html: cleanHtml(b.html) } : b)),
  };
}

/** A stored content; a damaged one opens as an empty page rather than failing. */
export function parseContent(raw: unknown): DocContent {
  const parsed = contentSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyContent();
}
const parseMargins = (raw: unknown): Margins => {
  const parsed = marginsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_MARGINS;
};

// ───────────────────────────── lists ─────────────────────────────

const view = (ctx: AccessContext, t: Row, names: Map<string, string>) => ({
  id: t.id,
  name: t.name,
  module: t.module,
  moduleLabel: printModule(t.module)?.label ?? t.module,
  brandId: t.brandId,
  brandCode: t.brand?.code ?? null,
  visibility: t.visibility as Visibility,
  status: t.status as TemplateStatus,
  isDefault: t.isDefault,
  dirty: t.dirty,
  version: t.version,
  paper: t.paper,
  ownerId: t.createdById,
  ownerName: names.get(t.createdById) ?? "",
  mine: t.createdById === ctx.userId,
  usageCount: t.usageCount,
  lastUsedAt: t.lastUsedAt,
  updatedAt: t.updatedAt,
  editable: canEdit(ctx, t),
  publishable: canPublish(ctx, t),
});
export type TemplateView = ReturnType<typeof view>;

/** Templates the user may see, optionally filtered. Other brands' templates and other people's personal ones are not there. */
export async function listTemplates(ctx: AccessContext, filter: { module?: string | null; brandId?: string | null; status?: string | null; owner?: "me" | null } = {}): Promise<TemplateView[]> {
  const rows = await store.docTemplates({
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.owner === "me" ? { createdById: ctx.userId } : {}),
    // brands outside the user's access are never read
    OR: [{ brandId: null }, { brandId: { in: ctx.brandIds } }],
  });
  const seen = rows.filter((t) => canSee(ctx, t) && (!filter.brandId || (filter.brandId === "all" ? t.brandId === null : t.brandId === filter.brandId)));
  const names = await store.userNames(seen.map((t) => t.createdById));
  return seen.map((t) => view(ctx, t, names));
}

async function loadSeen(ctx: AccessContext, id: string) {
  const t = await store.docTemplate(id);
  if (!t || !canSee(ctx, t)) throw new NotFoundError();
  return t;
}

export async function getTemplate(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  const names = await store.userNames([t.createdById, ...(t.approvedById ? [t.approvedById] : []), ...t.versions.map((v) => v.changedById ?? "")]);
  return {
    ...view(ctx, t, names),
    orientation: t.orientation as Orientation,
    margins: parseMargins(t.margins),
    cssOverrides: t.cssOverrides ?? "",
    content: parseContent(t.content),
    hasPublished: t.published !== null,
    publishedAt: t.publishedAt,
    approvedBy: t.approvedById ? (names.get(t.approvedById) ?? null) : null,
    versions: t.versions.map((v) => ({ version: v.version, changedAt: v.changedAt, changedBy: names.get(v.changedById ?? "") ?? "", note: v.note })),
    /** brand managers cannot publish a shared template themselves */
    needsApproval: canEdit(ctx, t) && !canPublish(ctx, t),
  };
}

/** Brands and visibilities the user may create templates with. */
export async function createOptions(ctx: AccessContext) {
  const { brandLetterheadRows } = await import("@/server/db/print-store");
  const brands = (await brandLetterheadRows(ctx.brandIds)).filter((b) => b.status !== "INACTIVE").sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, label: `${b.code} – ${b.name}`, shared: isBrandAdmin(ctx, b.id) || isBrandManager(ctx, b.id) }));
  return { brands, group: !!ctx.isAdmin };
}

// ───────────────────────────── create / change ─────────────────────────────

const metaSchema = z.object({
  name: z.string().trim().min(2, "Give the template a name").max(100),
  module: z.string().refine((m) => !!printModule(m), "Unknown module"),
  brandId: z.string().min(1).nullable(),
  visibility: z.enum(VISIBILITIES),
  paper: z.enum(PAPERS).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  starter: z.string().max(60).nullish(),
});

const snapshot = (t: Pick<Row, "name" | "status" | "version" | "visibility" | "module" | "isDefault">) => ({ name: t.name, status: t.status, version: t.version, visibility: t.visibility, module: t.module, isDefault: t.isDefault });

export async function createTemplate(ctx: AccessContext, input: z.input<typeof metaSchema>) {
  const data = metaSchema.parse(input);
  if (data.brandId && !ctx.brandIds.includes(data.brandId)) throw new NotFoundError();
  if (data.visibility === "GROUP") {
    if (!ctx.isAdmin) throw new ForbiddenError("Group templates are created by administrators");
    if (data.brandId) throw new BadRequestError("A group template belongs to all brands");
  } else if (data.visibility === "SHARED_BRAND") {
    if (!data.brandId) throw new BadRequestError("Choose the brand of the shared template");
    if (!isBrandAdmin(ctx, data.brandId) && !isBrandManager(ctx, data.brandId)) throw new ForbiddenError("Shared templates are created by the brand's manager, its Brand Admin or an administrator");
  } else if (FINANCIAL_MODULES.includes(data.module)) {
    throw new ForbiddenError(`${printModule(data.module)!.plural} are official documents: they use shared, published templates only`);
  }
  const starter = data.starter ? docStarter(data.starter) : null;
  if (data.starter && (!starter || starter.module !== data.module)) throw new BadRequestError("This starter is not available for the module");
  const content = cleanContent(starter?.content ?? emptyContent());
  const t = await store.createDocTemplate({ name: data.name, module: data.module, brandId: data.brandId, visibility: data.visibility, paper: starter?.paper ?? data.paper, orientation: data.orientation, margins: DEFAULT_MARGINS as object, content: content as object, createdById: ctx.userId });
  await audit({ ctx, action: "CREATE", entity: "DocumentTemplate", entityId: t.id, brandId: t.brandId, after: { ...snapshot(t), starter: starter?.key ?? null } });
  return { id: t.id };
}

const saveSchema = z.object({ name: z.string().trim().min(2).max(100), paper: z.enum(PAPERS), orientation: z.enum(["portrait", "landscape"]), margins: marginsSchema, content: z.unknown(), cssOverrides: z.string().max(400).default("") });

async function loadEditable(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  if (!canEdit(ctx, t)) throw new ForbiddenError("You cannot change this template");
  return t;
}

/** Saves the working copy. A published template keeps generating documents with its published version until the next publication. */
export async function saveTemplate(ctx: AccessContext, id: string, input: z.input<typeof saveSchema>) {
  const t = await loadEditable(ctx, id);
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("The template is waiting for approval – recall the request to change it");
  if (t.status === "ARCHIVED") throw new BadRequestError("Restore the template before changing it");
  const data = saveSchema.parse(input);
  const content = cleanContent(data.content);
  const broken = brokenFields(contentSource(content));
  if (broken.length) throw new BadRequestError(`Merge fields that cannot be read: ${broken.slice(0, 5).join(", ")}`);
  const css = cleanCss(data.cssOverrides);
  await store.updateDocTemplate(id, { name: data.name, paper: data.paper, orientation: data.orientation, margins: data.margins as object, content: content as object, cssOverrides: css.css || null, dirty: t.published !== null });
  await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), name: data.name, blocks: content.body.length, saved: "working copy" } });
  return { droppedCss: css.dropped };
}

/** Publishes the working copy as a new version (existing generated documents keep the version they were made with). */
export async function publishTemplate(ctx: AccessContext, id: string, note?: string | null) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t)) throw new ForbiddenError(t.visibility === "SHARED_BRAND" ? "Shared templates are published by the brand's Brand Admin or an administrator – submit it for approval" : "You cannot publish this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Decide the approval request instead (Approvals)");
  if (t.status === "ARCHIVED") throw new BadRequestError("Restore the template first");
  if (t.published !== null && !t.dirty) throw new BadRequestError("There are no changes to publish");
  const saved = await store.publishDocTemplate(id, ctx.userId, note?.trim().slice(0, 200) || null);
  await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(saved), published: true } });
  return { version: saved.version };
}

/** A brand manager's shared template goes to the brand's Brand Admin (or an administrator) through the approval engine. */
export async function submitTemplate(ctx: AccessContext, id: string) {
  const t = await loadEditable(ctx, id);
  if (canPublish(ctx, t)) throw new BadRequestError("You can publish this template yourself");
  if (t.visibility !== "SHARED_BRAND" || !t.brandId) throw new BadRequestError("Only shared brand templates need approval");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("The template is already waiting for approval");
  if (t.status === "ARCHIVED") throw new BadRequestError("Restore the template first");
  if (t.published !== null && !t.dirty) throw new BadRequestError("There are no changes to approve");
  const regionId = ctx.memberships.find((m) => m.brandId === t.brandId && m.regionId)?.regionId ?? (await defaultInboundRegion());
  if (!regionId) throw new BadRequestError("No region is available for this brand");
  await store.updateDocTemplate(id, { status: "PENDING_APPROVAL" });
  try {
    const { submitForApproval } = await import("@/server/modules/approvals/service");
    const outcome = await submitForApproval(ctx, { processKey: "DOCUMENT_TEMPLATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, regionId, title: `Document template "${t.name}" (${printModule(t.module)?.label ?? t.module})`, summary: t.published ? `Changes to version ${t.version}` : "New template" });
    await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), status: outcome.status === "APPROVED" ? "PUBLISHED" : "PENDING_APPROVAL", approvalRequestId: outcome.requestId } });
    return { status: outcome.status };
  } catch (err) {
    await store.updateDocTemplate(id, { status: t.status });
    throw err;
  }
}

export async function setDefault(ctx: AccessContext, id: string, on: boolean) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t) || t.visibility === "PERSONAL") throw new ForbiddenError("The default template of a brand is set by its Brand Admin or an administrator");
  if (on && t.published === null) throw new BadRequestError("Publish the template before making it the default");
  await store.setDefaultDocTemplate(id, t.module, t.brandId, on);
  await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: { isDefault: t.isDefault }, after: { isDefault: on } });
}

export async function archiveTemplate(ctx: AccessContext, id: string, archived: boolean) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t)) throw new ForbiddenError("You cannot archive this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Decide the approval request first");
  const status = archived ? "ARCHIVED" : t.published ? "PUBLISHED" : "DRAFT";
  await store.updateDocTemplate(id, { status, ...(archived ? { isDefault: false } : {}) });
  await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: { status: t.status }, after: { status } });
}

/** Deletes a template nobody generated a document with; a used one can only be archived (its copies refer to it). */
export async function deleteTemplate(ctx: AccessContext, id: string) {
  const t = await loadEditable(ctx, id);
  if (t.published !== null && !canPublish(ctx, t)) throw new ForbiddenError("A published template is removed by whoever may publish it");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Recall the approval request first");
  if ((await store.generatedCount(id)) > 0) throw new BadRequestError("Documents were generated with this template – archive it instead");
  await store.deleteDocTemplate(id);
  await audit({ ctx, action: "DELETE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: snapshot(t) });
}

/** Puts an earlier version into the working copy (to be published again – the history is never rewritten). */
export async function restoreVersion(ctx: AccessContext, id: string, version: number) {
  const t = await loadEditable(ctx, id);
  if (t.status === "PENDING_APPROVAL" || t.status === "ARCHIVED") throw new BadRequestError("The template cannot be changed in this state");
  const v = await store.docTemplateVersion(id, version);
  if (!v) throw new NotFoundError();
  const snap = v.snapshot as { name?: string; paper?: string; orientation?: string; margins?: unknown; content?: unknown; cssOverrides?: string | null };
  await store.updateDocTemplate(id, { content: parseContent(snap.content) as object, margins: parseMargins(snap.margins) as object, paper: snap.paper ?? t.paper, orientation: snap.orientation ?? t.orientation, cssOverrides: cleanCss(snap.cssOverrides).css || null, dirty: true });
  await audit({ ctx, action: "UPDATE", entity: "DocumentTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), restoredVersion: version } });
}

// ───────────────────────────── preview ─────────────────────────────

const previewSchema = z.object({ module: z.string(), brandId: z.string().nullable(), paper: z.enum(PAPERS), orientation: z.enum(["portrait", "landscape"]), margins: marginsSchema, content: z.unknown(), cssOverrides: z.string().max(400).default(""), recordId: z.string().max(60).nullish() });

async function buildPreview(ctx: AccessContext, input: unknown) {
  const data = previewSchema.parse(input);
  if (data.brandId && !ctx.brandIds.includes(data.brandId)) throw new NotFoundError();
  const content = cleanContent(data.content);
  const { previewCompiled } = await import("@/server/modules/print/service");
  // the preview record is one the user can open (404 otherwise); a brand template previews with a record of that brand
  const p = await previewCompiled(ctx, { module: data.module, brandId: data.brandId, recordId: data.recordId, paper: data.paper as Paper, orientation: data.orientation, compile: (record, lh) => compileDoc(content, record, lh, { printedBy: ctx.user.name, margins: data.margins, css: sheetCss(data.cssOverrides) }) });
  const known = p.record ? [...Object.entries(p.record.merge).flatMap(([g, values]) => Object.keys(values).map((k) => `${g}.${k}`)), ...["name", "code", "legalEntity", "address", "phone", "email", "website", "rcNumber", "vatNumber", "bankDetails"].map((k) => `brand.${k}`), "user.name", "today", "amountInWords", "page", "pages", ...(p.record.tables.flatMap((t) => t.columns.map((c) => `row.${c.key}`))), "row.index"] : null;
  const source = contentSource(content);
  return { p, content, lint: { errors: brokenFields(source).map((f) => `Cannot be read: ${f}`), unknown: known ? unknownFields(source, known) : [], droppedCss: cleanCss(data.cssOverrides).dropped } };
}

/** The builder's preview: the working copy (not saved) for a record the user can open, with the checks. */
export async function previewTemplate(ctx: AccessContext, input: unknown) {
  const { p, lint } = await buildPreview(ctx, input);
  return { html: p.html, record: p.record ? { id: p.record.id, title: p.record.title } : null, lint };
}

/** "Download test PDF": the preview as a PDF (watermarked PREVIEW, not stored, not a document). */
export async function previewTemplatePdf(ctx: AccessContext, input: unknown): Promise<Uint8Array> {
  const { p } = await buildPreview(ctx, input);
  if (!p.record || !p.layout) throw new BadRequestError("There is no record to preview with");
  const { previewPdf } = await import("@/server/modules/print/service");
  return previewPdf(p.html, { record: p.record, layout: p.layout, letterhead: p.letterhead, options: p.options });
}

/** What the builder offers for a module: fields, related lists and merge fields, read from a record the user can open. */
export async function builderCatalogue(ctx: AccessContext, moduleKey: string, recordId?: string | null) {
  const { sampleRecord, sampleChoices } = await import("@/server/modules/print/service");
  const [sample, samples] = await Promise.all([sampleRecord(ctx, moduleKey, recordId), sampleChoices(ctx, moduleKey)]);
  return {
    samples,
    sampleId: sample?.id ?? null,
    sampleTitle: sample?.title ?? null,
    fields: (sample?.fields ?? []).map((f) => ({ key: f.key, label: f.label })),
    lists: (sample?.tables ?? []).filter((t) => t.key !== "lines").map((t) => ({ key: t.key, label: t.title, columns: t.columns.map((c) => c.key) })),
    lineColumns: [{ key: "sn", label: "S/N" }, ...(sample?.lines?.columns ?? []).map((c) => ({ key: c.key, label: c.label }))],
    mergeFields: [
      ...(sample ? Object.entries(sample.merge).flatMap(([group, values]) => Object.keys(values).map((k) => `${group}.${k}`)).filter((f) => !f.startsWith("record.")) : []),
      ...["name", "legalEntity", "address", "phone", "email", "website", "rcNumber", "vatNumber"].map((k) => `brand.${k}`),
      "user.name",
      "today",
      "amountInWords",
    ].sort(),
  };
}

// ───────────────────────────── use by the print engine ─────────────────────────────

/** Document templates offered for a record at print / send time (ids are prefixed "doc:"). */
export async function docChoicesFor(ctx: AccessContext, record: Pick<PrintRecord, "module" | "brandId">): Promise<Array<{ id: string; name: string; builtin: boolean; brandCode: string | null; isDefault: boolean }>> {
  const rows = (await store.docTemplates({ module: record.module, status: { not: "ARCHIVED" }, OR: [{ brandId: null }, { brandId: { in: ctx.brandIds } }] })).filter((t) => usable(ctx, t, record));
  const def = defaultOf(rows, record);
  return rows.map((t) => ({ id: `doc:${t.id}`, name: t.visibility === "PERSONAL" ? `${t.name} (personal)` : t.name, builtin: false, brandCode: t.brand?.code ?? null, isDefault: t.id === def?.id }));
}

/** The default of a record: the brand's own default before the group's. */
const defaultOf = (rows: Row[], record: Pick<PrintRecord, "brandId">) => rows.filter((t) => t.isDefault && t.visibility !== "PERSONAL").sort((a, b) => Number(b.brandId === record.brandId && !!b.brandId) - Number(a.brandId === record.brandId && !!a.brandId))[0];

export interface ResolvedDoc {
  templateId: string;
  name: string;
  version: number;
  paper: Paper;
  orientation: Orientation;
  compile: (record: PrintRecord, lh: Letterhead, printedBy: string) => PrintLayout;
}

/**
 * The published version of a template for a record – null when the template does not exist FOR THIS USER AND RECORD
 * (other brand, other module, someone's personal template, a personal template on a financial document, archived).
 * With `id` null: the default template of the record's module and brand, if there is one.
 */
export async function resolveDocTemplate(ctx: AccessContext, id: string | null, record: PrintRecord, _preview = false): Promise<ResolvedDoc | null> {
  let t: Row | null | undefined;
  if (id) t = await store.docTemplate(id);
  else t = defaultOf((await store.docTemplates({ module: record.module, isDefault: true, status: { not: "ARCHIVED" }, OR: [{ brandId: null }, { brandId: { in: ctx.brandIds } }] })).filter((x) => usable(ctx, x, record)), record);
  if (!t || !usable(ctx, t, record)) return null;
  const content = parseContent(t.published);
  const margins = parseMargins(t.margins);
  const css = sheetCss(t.cssOverrides);
  return { templateId: t.id, name: t.name, version: t.version, paper: (PAPERS as readonly string[]).includes(t.paper) ? (t.paper as Paper) : "A4", orientation: t.orientation === "landscape" ? "landscape" : "portrait", compile: (r, lh, printedBy) => compileDoc(content, r, lh, { printedBy, margins, css }) };
}

export async function recordUse(templateId: string): Promise<void> {
  await store.touchDocTemplate(templateId).catch(() => undefined);
}

// ───────────────────────────── generated documents ─────────────────────────────

/** Keeps the exact PDF that left the system (brand-scoped storage key, SHA-256). Called by the print engine. */
export async function storeGenerated(ctx: AccessContext, g: { template: { templateId: string; version: number } | null; templateName: string; module: string; recordId: string; brandId: string; fileName: string; bytes: Uint8Array; pages: number; sentVia: "EMAIL" | "PRINT" | "DOWNLOAD" | "WHATSAPP" }): Promise<string> {
  const fileKey = `generated/${g.brandId}/${new Date().getFullYear()}/${randomUUID()}.pdf`;
  await storage().put(fileKey, g.bytes, "application/pdf");
  const hash = createHash("sha256").update(g.bytes).digest("hex");
  const row = await store.createGenerated({ templateId: g.template?.templateId ?? null, templateVersion: g.template?.version ?? 0, templateName: g.templateName, module: g.module, recordId: g.recordId, brandId: g.brandId, fileKey, fileName: g.fileName, hash, pages: g.pages, generatedById: ctx.userId, generatedByName: ctx.user.name, sentVia: g.sentVia });
  await audit({ ctx, action: "CREATE", entity: "GeneratedDocument", entityId: row.id, brandId: g.brandId, after: { module: g.module, recordId: g.recordId, template: g.templateName, templateVersion: g.template?.version ?? null, sentVia: g.sentVia, hash, pages: g.pages } });
  return row.id;
}

/** The stored copies of a record – only for someone who can open the record (404 otherwise). */
export async function generatedFor(ctx: AccessContext, moduleKey: string, recordId: string) {
  const { loadPrintRecord } = await import("@/server/modules/print/service");
  await loadPrintRecord(ctx, moduleKey, recordId);
  return (await store.generatedOf(moduleKey, recordId)).map((g) => ({ id: g.id, fileName: g.fileName, templateName: g.templateName, templateVersion: g.templateVersion, generatedAt: g.generatedAt, generatedBy: g.generatedByName, sentVia: g.sentVia, pages: g.pages, hash: g.hash }));
}

/** The file of a stored copy, verified against its hash. The reader must be able to open the record it belongs to. */
export async function generatedFile(ctx: AccessContext, id: string, expect?: { module: string; recordId: string }) {
  const g = await store.generatedById(id);
  if (!g || (expect && (g.module !== expect.module || g.recordId !== expect.recordId))) throw new NotFoundError();
  const { loadPrintRecord } = await import("@/server/modules/print/service");
  await loadPrintRecord(ctx, g.module, g.recordId);
  const bytes = await storage().get(g.fileKey);
  if (createHash("sha256").update(bytes).digest("hex") !== g.hash) throw new BadRequestError("The stored copy does not match its checksum");
  await audit({ ctx, action: "EXPORT", entity: "GeneratedDocument", entityId: g.id, brandId: g.brandId, after: { module: g.module, recordId: g.recordId, reused: true } });
  return { bytes, fileName: g.fileName, id: g.id };
}

export const linkGeneratedEmail = (id: string, activityId: string) => store.linkGeneratedEmail(id, activityId).catch(() => undefined);

/** After a document went to the customer: an approved quote becomes Sent; sales orders and invoices get their sent date. */
export async function markSent(ctx: AccessContext, moduleKey: string, recordId: string): Promise<void> {
  if (moduleKey === "quotes") {
    const { markQuoteSent } = await import("@/server/modules/documents/service");
    await markQuoteSent(ctx, recordId).catch(() => undefined); // only approved quotes change state; others stay as they are
  } else await store.markDocumentSent(moduleKey, recordId);
}

/** A copy of a template the user can see. It keeps the visibility when they may write that kind, else it is personal. */
export async function cloneTemplate(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  const same = canEdit(ctx, t);
  const brandId = t.brandId && ctx.brandIds.includes(t.brandId) ? t.brandId : null;
  const created = await createTemplate(ctx, { name: `${t.name} (copy)`.slice(0, 100), module: t.module, brandId: same ? t.brandId : brandId, visibility: same ? (t.visibility as Visibility) : "PERSONAL", paper: (PAPERS as readonly string[]).includes(t.paper) ? (t.paper as "A4") : "A4", orientation: t.orientation === "landscape" ? "landscape" : "portrait" });
  await store.updateDocTemplate(created.id, { content: parseContent(t.published ?? t.content) as object, margins: parseMargins(t.margins) as object, cssOverrides: t.cssOverrides });
  return created;
}
