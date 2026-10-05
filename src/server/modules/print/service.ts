/**
 * Print engine (prompt 20 Part A): one pipeline for the browser print preview, PDF downloads, bulk jobs and PDF
 * attachments of e-mails.
 *
 *   renderPrint({ module, recordIds, templateId, companyBrandId, … }, userCtx)
 *     1. loads every record with the USER's access (the module's own detail query – a hidden record is a 404,
 *        fields are masked exactly as on screen),
 *     2. decides the letterhead: a brand-owned record ALWAYS prints on its own brand's letterhead; only shared
 *        records and lists let the user choose, and only among brands they can access,
 *     3. builds the HTML from the template's blocks,
 *     4. for PDFs: headless Chromium when available, else the pdf-lib renderer,
 *     5. writes the audit entry (who, module, records, template, letterhead, pages).
 */
import "server-only";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as store from "@/server/db/print-store";
import { BadRequestError } from "@/server/errors";
import { assertSetup, assertSetupBrand, setupBrandIds } from "@/server/modules/setup/access";
import { getSetting } from "@/server/modules/setup/service";
import { z } from "zod";
import { BUILTIN_TEMPLATES, builtinsFor, renderListHtml, renderRecordsHtml, type Letterhead, type ListPrint, type Orientation, type Paper, type PrintBlock, type PrintLayout, type PrintOptions } from "./blocks";
import { describeRecord, type PrintRecord } from "./describe";
import { PRINT_MODULES, printModule, type PrintModule } from "./modules";
import { basicListPdf, basicRecordsPdf, chromiumPdf, pageCount, type PdfEngine } from "./pdf";
import { MAX_HTML, cleanHtml } from "./sanitize";

export const MAX_BULK = 500;
const DOCUMENT_MODULES = new Set(["quotes", "salesOrders", "invoices"]);

const appUrl = () => (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "");

// ───────────────────────────── letterheads ─────────────────────────────

function toLetterhead(row: store.LetterheadRow): Letterhead {
  return {
    brandId: row.id,
    code: row.code,
    name: row.name,
    legalEntity: row.legalEntity || row.name,
    rcNumber: row.rcNumber,
    address: row.address,
    phone: row.phone,
    email: row.contactEmail ?? row.fromEmail,
    website: row.website,
    vatNumber: row.vatNumber,
    bankDetails: row.bankDetails,
    color: row.color ?? "#1565d0",
    footerText: row.footerText,
    logo: row.logoData && row.logoMimeType ? `data:${row.logoMimeType};base64,${Buffer.from(row.logoData).toString("base64")}` : null,
  };
}

/** The group letterhead (Setup → Company Details): for printouts that are not one brand's. */
export async function groupLetterhead(): Promise<Letterhead> {
  const c = await getSetting("company");
  return { brandId: null, code: "GROUP", name: c.name, legalEntity: c.name, rcNumber: null, address: c.address || null, phone: c.phone || null, email: c.email || null, website: null, vatNumber: null, bankDetails: null, color: "#1e2638", footerText: null, logo: null };
}

/** The group letterhead is for people who see every brand (Management, Administrator). */
export const canUseGroupLetterhead = (ctx: AccessContext) => ctx.scope === "ALL";

/** "Print as company" choices: only brands the user can access, plus Group for those who see all brands. */
export async function companyOptions(ctx: AccessContext): Promise<Array<{ id: string; label: string }>> {
  const rows = await store.brandLetterheadRows(ctx.brandIds);
  const brands = rows.filter((b) => b.status !== "INACTIVE").sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, label: `${b.code} – ${b.legalEntity || b.name}` }));
  return canUseGroupLetterhead(ctx) ? [...brands, { id: "group", label: "Group letterhead" }] : brands;
}

/**
 * Letterheads for a set of records. A record with a brand gets that brand's letterhead – whatever was asked for.
 * Records without a brand (shared customers) get the requested company if the user can access it, else the user's
 * only brand, else the group letterhead (when allowed), else the user's first brand.
 */
async function letterheadsFor(ctx: AccessContext, records: PrintRecord[], companyBrandId: string | null | undefined): Promise<{ of: (r: PrintRecord) => Letterhead; chosen: Letterhead | null; brandRows: Map<string, store.LetterheadRow> }> {
  const recordBrands = [...new Set(records.map((r) => r.brandId).filter((b): b is string => !!b))];
  const rows = await store.brandLetterheadRows([...new Set([...recordBrands, ...ctx.brandIds])]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const needsChoice = records.some((r) => !r.brandId);
  let chosen: Letterhead | null = null;
  if (needsChoice) {
    if (companyBrandId && companyBrandId !== "group") {
      // the 404 rule: a brand outside the user's access does not exist for them
      if (!ctx.brandIds.includes(companyBrandId) || !byId.has(companyBrandId)) throw new NotFoundError();
      chosen = toLetterhead(byId.get(companyBrandId)!);
    } else if (companyBrandId === "group") {
      if (!canUseGroupLetterhead(ctx)) throw new NotFoundError();
      chosen = await groupLetterhead();
    } else if (ctx.brandIds.length === 1 && byId.has(ctx.brandIds[0]!)) chosen = toLetterhead(byId.get(ctx.brandIds[0]!)!);
    else if (canUseGroupLetterhead(ctx)) chosen = await groupLetterhead();
    else if (ctx.brandIds[0] && byId.has(ctx.brandIds[0])) chosen = toLetterhead(byId.get(ctx.brandIds[0])!);
    else chosen = await groupLetterhead();
  }
  return {
    brandRows: byId,
    chosen,
    of: (r) => {
      const row = r.brandId ? byId.get(r.brandId) : undefined;
      return row ? toLetterhead(row) : (chosen as Letterhead);
    },
  };
}

/**
 * Letterhead for a page printed from the screen (reports, dashboards): the brand selected in the switcher or the
 * user's only brand; with several brands the group letterhead for people who see every brand, else the first brand.
 */
export async function screenLetterhead(ctx: AccessContext, selectedBrandId?: string | null): Promise<Letterhead> {
  const { getUiFilters } = await import("@/server/request");
  const brandId = selectedBrandId ?? (await getUiFilters(ctx)).brandId ?? (ctx.brandIds.length === 1 ? ctx.brandIds[0]! : null);
  if (brandId && ctx.brandIds.includes(brandId)) {
    const row = (await store.brandLetterheadRows([brandId]))[0];
    if (row) return toLetterhead(row);
  }
  if (canUseGroupLetterhead(ctx) || !ctx.brandIds[0]) return groupLetterhead();
  const row = (await store.brandLetterheadRows([ctx.brandIds[0]]))[0];
  return row ? toLetterhead(row) : groupLetterhead();
}

/** Audit entry for a page printed with the browser (the server cannot see the paper, only that the print view was opened). */
export async function auditScreenPrint(ctx: AccessContext, what: string, letterhead: string): Promise<void> {
  await audit({ ctx, action: "EXPORT", entity: "Print", entityId: what, after: { via: "screen", letterhead } });
}

// ───────────────────────────── records ─────────────────────────────

function moduleOrThrow(key: string): PrintModule {
  const mod = printModule(key);
  if (!mod) throw new NotFoundError();
  return mod;
}

/** Loads one record for printing with the user's access. NotFoundError for a hidden or missing record. */
export async function loadPrintRecord(ctx: AccessContext, moduleKey: string, id: string): Promise<PrintRecord> {
  const mod = moduleOrThrow(moduleKey);
  assertCan(ctx, mod.permission, "read");
  const row = await mod.load(ctx, id);
  return describeRecord({ module: mod.key, moduleLabel: mod.label, mergeName: mod.mergeName, record: row });
}

// ───────────────────────────── templates ─────────────────────────────

export interface TemplateChoice {
  id: string;
  name: string;
  builtin: boolean;
  brandCode: string | null;
  isDefault: boolean;
}

/** Templates offered at print time: the module's, for the record's brand or for every brand – never another brand's. */
export async function templateChoices(ctx: AccessContext, record: PrintRecord): Promise<TemplateChoice[]> {
  const rows = await scopedDb(ctx).printTemplate.findMany({
    where: { module: record.module, active: true, OR: [{ brandId: null }, ...(record.brandId ? [{ brandId: record.brandId }] : [{ brandId: { in: ctx.brandIds } }])] },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true, brand: { select: { code: true } } },
  });
  // document templates of the template builder (prompt 21) come first; their ids start with "doc:"
  const docs = await (await import("@/server/modules/doctpl/service")).docChoicesFor(ctx, record);
  return [...docs, ...rows.map((t) => ({ id: t.id, name: t.name, builtin: false, brandCode: t.brand?.code ?? null, isDefault: t.isDefault && !docs.some((d) => d.isDefault) })), ...builtinsFor(record).map((b) => ({ id: `builtin:${b.key}`, name: b.name, builtin: true, brandCode: null, isDefault: false }))];
}

/** The built-in a module prints with when nothing else is chosen: the most specific one that applies. */
function defaultBuiltin(record: PrintRecord) {
  const list = builtinsFor(record);
  return list.find((b) => !b.modules.includes("*")) ?? list[0]!;
}

interface Resolved {
  id: string;
  name: string;
  layout: PrintLayout;
  paper: Paper | null;
  orientation: Orientation | null;
  /** document templates are compiled per record (conditional sections, the record's own letterhead) */
  compile?: (record: PrintRecord, lh: Letterhead, printedBy: string) => PrintLayout;
  doc?: { templateId: string; version: number };
}

async function resolveTemplate(ctx: AccessContext, record: PrintRecord, templateId: string | null | undefined, preview = false): Promise<Resolved> {
  if (templateId?.startsWith("doc:") || !templateId) {
    // a document template the user may use for THIS record (module, brand, visibility, published) – or the default one
    const doc = await (await import("@/server/modules/doctpl/service")).resolveDocTemplate(ctx, templateId ? templateId.slice(4) : null, record, preview);
    if (doc) return { id: `doc:${doc.templateId}`, name: doc.name, layout: { blocks: [] }, paper: doc.paper, orientation: doc.orientation, compile: doc.compile, doc: { templateId: doc.templateId, version: doc.version } };
    if (templateId) throw new NotFoundError();
  }
  if (templateId?.startsWith("builtin:")) {
    const b = builtinsFor(record).find((x) => `builtin:${x.key}` === templateId);
    if (!b) throw new NotFoundError();
    return { id: templateId, name: b.name, layout: b.layout(record), paper: null, orientation: null };
  }
  const db = scopedDb(ctx);
  const brandFilter = record.brandId ? [{ brandId: null }, { brandId: record.brandId }] : [{ brandId: null }, { brandId: { in: ctx.brandIds } }];
  if (templateId) {
    // a template of another module or another brand does not exist for this record
    const t = await db.printTemplate.findFirst({ where: { id: templateId, module: record.module, active: true, OR: brandFilter } });
    if (!t) throw new NotFoundError();
    return { id: t.id, name: t.name, layout: parseLayout(t.layout), paper: t.paper as Paper, orientation: t.orientation as Orientation };
  }
  const def = (await db.printTemplate.findMany({ where: { module: record.module, active: true, isDefault: true, OR: brandFilter }, orderBy: { updatedAt: "desc" } })).sort((a, b) => Number(!!b.brandId) - Number(!!a.brandId))[0];
  if (def) return { id: def.id, name: def.name, layout: parseLayout(def.layout), paper: def.paper as Paper, orientation: def.orientation as Orientation };
  const b = defaultBuiltin(record);
  return { id: `builtin:${b.key}`, name: b.name, layout: b.layout(record), paper: null, orientation: null };
}

const blockSchema: z.ZodType<PrintBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("letterhead") }),
  z.object({ type: z.literal("title"), text: z.string().max(200) }),
  z.object({ type: z.literal("fields"), title: z.string().max(80).optional(), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]), fields: z.array(z.string().max(80)).max(80) }),
  z.object({ type: z.literal("richText"), html: z.string().max(MAX_HTML) }),
  z.object({ type: z.literal("lineItems"), title: z.string().max(80).optional() }),
  z.object({ type: z.literal("related"), list: z.string().max(60), title: z.string().max(80).optional() }),
  z.object({ type: z.literal("totals") }),
  z.object({ type: z.literal("terms"), html: z.string().max(MAX_HTML).optional() }),
  z.object({ type: z.literal("signatures"), roles: z.array(z.string().trim().min(1).max(40)).max(4) }),
  z.object({ type: z.literal("qr"), value: z.enum(["url", "vin", "number"]), caption: z.string().max(80).optional() }),
  z.object({ type: z.literal("barcode"), value: z.enum(["vin", "number"]) }),
  z.object({ type: z.literal("image"), url: z.string().max(400_000), alt: z.string().max(120), widthMm: z.number().min(10).max(180) }),
  z.object({ type: z.literal("pageBreak") }),
  z.object({ type: z.literal("footer"), text: z.string().max(300) }),
]);
const layoutSchema = z.object({ blocks: z.array(blockSchema).min(1).max(60) });

/** A stored layout; an invalid one (edited by hand in the database) prints as the letterhead only rather than failing. */
export function parseLayout(raw: unknown): PrintLayout {
  const parsed = layoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : { blocks: [{ type: "letterhead" }] };
}

/** Validates a layout from the designer and sanitises every piece of HTML in it. */
export function cleanLayout(raw: unknown): PrintLayout {
  const layout = layoutSchema.parse(raw);
  return {
    blocks: layout.blocks.map((b) => {
      if (b.type === "richText") return { ...b, html: cleanHtml(b.html) };
      if (b.type === "terms" && b.html) return { ...b, html: cleanHtml(b.html) };
      if (b.type === "image") {
        if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(b.url) && !/^https:\/\/[^\s"'<>]+$/.test(b.url)) throw new BadRequestError("An image must be uploaded or have an https address");
        return b;
      }
      return b;
    }),
  };
}

// ───────────────────────────── rendering ─────────────────────────────

export interface PrintRequest {
  module: string;
  recordIds: string[];
  templateId?: string | null;
  /** only used for records without a brand (shared customers): a brand id the user can access, or "group" */
  companyBrandId?: string | null;
  paper?: Paper | null;
  orientation?: Orientation | null;
  /** how the output leaves the system – recorded in the audit entry */
  via: "preview" | "pdf" | "bulk" | "email";
}

interface Prepared {
  records: PrintRecord[];
  template: Awaited<ReturnType<typeof resolveTemplate>>;
  layoutFor: (r: PrintRecord) => PrintLayout;
  letterheadFor: (r: PrintRecord) => Letterhead;
  options: PrintOptions;
  mod: PrintModule;
}

async function prepare(ctx: AccessContext, req: PrintRequest): Promise<Prepared> {
  const mod = moduleOrThrow(req.module);
  const ids = [...new Set(req.recordIds)];
  if (!ids.length) throw new BadRequestError("Nothing to print");
  if (ids.length > MAX_BULK) throw new BadRequestError(`At most ${MAX_BULK} records per print job`);
  // several records of a customer-list module are an export of customer data
  if (ids.length > 1 && mod.exportSensitive && !hasPermission(ctx, mod.permission, "export")) throw new ForbiddenError(`Printing several ${mod.plural.toLowerCase()} needs the export permission`);
  // every id must be visible to the user: one hidden record fails the whole request (nothing is skipped silently)
  const records: PrintRecord[] = [];
  for (const id of ids) records.push(await loadPrintRecord(ctx, mod.key, id));

  const template = await resolveTemplate(ctx, records[0]!, req.templateId, req.via === "preview");
  // every record of a bulk print must be one the document template may be used for (its brand, its module)
  if (template.doc) for (const r of records.slice(1)) if (!(await (await import("@/server/modules/doctpl/service")).resolveDocTemplate(ctx, template.doc.templateId, r, req.via === "preview"))) throw new NotFoundError();
  const lh = await letterheadsFor(ctx, records, req.companyBrandId);
  // a built-in layout depends on the record (its fields), a document template is compiled for it; a stored print template is the same for all
  const builtin = template.id.startsWith("builtin:") ? BUILTIN_TEMPLATES.find((b) => `builtin:${b.key}` === template.id) : null;
  const compiled = new Map<string, PrintLayout>();
  const layoutFor = (r: PrintRecord) => {
    if (builtin) return builtin.layout(r);
    if (!template.compile) return template.layout;
    if (!compiled.has(r.id)) compiled.set(r.id, template.compile(r, lh.of(r), ctx.user.name));
    return compiled.get(r.id)!;
  };

  // documents print COPY after their first print, when the brand asks for it
  let watermark: string | null = null;
  if (records.length === 1 && DOCUMENT_MODULES.has(mod.key) && req.via !== "preview") {
    const row = records[0]!.brandId ? lh.brandRows.get(records[0]!.brandId) : null;
    if (row?.copyWatermark && (await store.printCount(mod.key, records[0]!.id)) > 0) watermark = "COPY";
  }
  const options: PrintOptions = {
    paper: req.paper ?? template.paper ?? "A4",
    orientation: req.orientation ?? template.orientation ?? "portrait",
    watermark,
    printedBy: ctx.user.name,
    printedAt: new Date(),
    appUrl: appUrl(),
    recordPath: (r) => mod.path(r.id),
    pageLine: template.compile ? (layoutFor(records[0]!).pageLine ?? null) : null,
  };
  return { records, template, layoutFor, letterheadFor: lh.of, options, mod };
}

async function auditPrint(ctx: AccessContext, p: Prepared, via: PrintRequest["via"], extra: Record<string, unknown> = {}) {
  // one entry per record, so "who printed this invoice" is a lookup by record
  for (const r of p.records.slice(0, MAX_BULK)) {
    const lh = p.letterheadFor(r);
    await audit({ ctx, action: "EXPORT", entity: "Print", entityId: `${p.mod.key}:${r.id}`, brandId: r.brandId, after: { module: p.mod.key, via, template: p.template.name, templateId: p.template.id, ...(p.template.doc ? { templateVersion: p.template.doc.version } : {}), letterhead: lh.code, records: p.records.length, ...extra } });
  }
  if (p.template.doc && via !== "preview") await (await import("@/server/modules/doctpl/service")).recordUse(p.template.doc.templateId);
}

/** The print HTML of one or more records (browser print preview). Audited when `audited` is not false. */
export async function renderPrintHtml(ctx: AccessContext, req: PrintRequest, opts: { toolbar?: string; audited?: boolean } = {}): Promise<{ html: string; prepared: Prepared }> {
  const p = await prepare(ctx, req);
  // every record uses its own layout (built-ins) – render record by record and join the sheets
  const html = renderRecordsHtmlPerRecord(p, opts.toolbar);
  if (opts.audited !== false) await auditPrint(ctx, p, req.via);
  return { html, prepared: p };
}

function renderRecordsHtmlPerRecord(p: Prepared, toolbar?: string): string {
  if (p.records.length === 1 || !(p.template.id.startsWith("builtin:") || p.template.compile)) return renderRecordsHtml({ records: p.records, layout: p.layoutFor(p.records[0]!), letterheadFor: p.letterheadFor, options: p.options, toolbar });
  // built-in layouts differ per record: render each and merge the <section> elements into the first document
  const docs = p.records.map((r) => renderRecordsHtml({ records: [r], layout: p.layoutFor(r), letterheadFor: p.letterheadFor, options: p.options, toolbar: "" }));
  const sections = docs.map((d) => /<section[\s\S]*<\/section>/.exec(d)?.[0] ?? "").join("\n");
  return docs[0]!.replace(/<section[\s\S]*<\/section>/, () => sections).replace("<body>", `<body>${toolbar ?? ""}`);
}

export interface PdfResult {
  bytes: Uint8Array;
  fileName: string;
  pages: number;
  engine: PdfEngine;
  /** id of the stored copy (GeneratedDocument) – set when the PDF left the system for one record of a brand */
  generatedId: string | null;
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

/** Server-rendered PDF of one or more records. */
export async function renderPrintPdf(ctx: AccessContext, req: PrintRequest): Promise<PdfResult> {
  const p = await prepare(ctx, req);
  const html = renderRecordsHtmlPerRecord(p);
  let engine: PdfEngine = "chromium";
  let bytes = await chromiumPdf(html, { ...p.options, pageLine: p.options.pageLine });
  if (!bytes) {
    engine = "basic";
    bytes = await basicRecordsPdf({ records: p.records, layoutFor: p.layoutFor, letterheadFor: p.letterheadFor, options: p.options });
  }
  const pages = await pageCount(bytes);
  await auditPrint(ctx, p, req.via, { pages, engine });
  const first = p.records[0]!;
  const fileName = p.records.length === 1 ? `${safeName(`${p.mod.label}-${first.number ?? first.title}`)}.pdf` : `${safeName(p.mod.plural)}-${p.records.length}.pdf`;
  // The exact copy that left the system is kept (prompt 21 §5): every e-mailed PDF, and every PDF made with a
  // document template. Previews are not documents.
  let generatedId: string | null = null;
  const brandId = first.brandId ?? p.letterheadFor(first).brandId;
  if (p.records.length === 1 && brandId && req.via !== "preview" && (req.via === "email" || p.template.doc)) {
    generatedId = await (await import("@/server/modules/doctpl/service")).storeGenerated(ctx, { template: p.template.doc ?? null, templateName: p.template.name, module: p.mod.key, recordId: first.id, brandId, fileName, bytes, pages, sentVia: req.via === "email" ? "EMAIL" : "DOWNLOAD" });
  }
  return { bytes, fileName, pages, engine, generatedId };
}

// ───────────────────────────── list print ─────────────────────────────

const LIST_SKIP = new Set(["description", "notes", "terms", "body", "address"]);

/**
 * The records of a list view as one table. Customer lists need the export permission. Several brands in one list →
 * the group letterhead (for people who may use it) with a brand column; otherwise the brand's own letterhead.
 */
export async function renderListPrint(ctx: AccessContext, req: { module: string; ids: string[]; companyBrandId?: string | null; title?: string | null; orientation?: Orientation | null; paper?: Paper | null; format: "html" | "pdf"; toolbar?: string }): Promise<{ html: string; pdf: PdfResult | null }> {
  const mod = moduleOrThrow(req.module);
  assertCan(ctx, mod.permission, "read");
  if (mod.exportSensitive && !hasPermission(ctx, mod.permission, "export")) throw new ForbiddenError(`Printing a list of ${mod.plural.toLowerCase()} needs the export permission`);
  const ids = [...new Set(req.ids)].slice(0, MAX_BULK);
  if (!ids.length) throw new BadRequestError("The list is empty");
  const records: PrintRecord[] = [];
  for (const id of ids) records.push(await loadPrintRecord(ctx, mod.key, id));

  const brands = [...new Set(records.map((r) => r.brandId).filter((b): b is string => !!b))];
  const mixed = brands.length > 1;
  const rows = await store.brandLetterheadRows([...new Set([...brands, ...ctx.brandIds])]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let letterhead: Letterhead;
  if (mixed) {
    // several brands on one page: the group's letterhead; a user who sees only some brands still gets one of THEIR brands' heads
    letterhead = canUseGroupLetterhead(ctx) ? await groupLetterhead() : toLetterhead(byId.get(brands[0]!)!);
  } else if (brands.length === 1) letterhead = toLetterhead(byId.get(brands[0]!)!);
  else letterhead = (await letterheadsFor(ctx, records, req.companyBrandId)).chosen ?? (await groupLetterhead());

  // columns: the fields most of the records have a short value for, in the order of the module's record
  const counts = new Map<string, { label: string; n: number; right: boolean }>();
  for (const r of records) {
    for (const f of r.fields) {
      if (LIST_SKIP.has(f.key) || f.key.startsWith("cf.") || f.value.length > 60 || !f.value) continue;
      const c = counts.get(f.key) ?? { label: f.label, n: 0, right: ["money", "number", "percent"].includes(f.kind) };
      c.n++;
      counts.set(f.key, c);
    }
  }
  const landscape = (req.orientation ?? "landscape") === "landscape";
  const keys = [...counts.entries()].filter(([k, c]) => c.n >= Math.ceil(records.length / 3) && !(k === "brand" && !mixed)).slice(0, landscape ? 9 : 6).map(([k]) => k);
  if (mixed && !keys.includes("brand")) keys.unshift("brand");
  const value = (r: PrintRecord, k: string) => r.fields.find((f) => f.key === k)?.value ?? "";
  const sumKey = ["amount", "total", "grandTotal"].find((k) => keys.includes(k));
  const sum = sumKey ? records.reduce((s, r) => s + (Number(r.merge.record?.[sumKey]) || 0), 0) : null;
  const policy = await getSetting("printPolicy");
  const watermark = policy.watermarkProfileIds.includes(ctx.profile.id) ? `Internal – ${ctx.user.name} – ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos" }).format(new Date())}` : null;
  const list: ListPrint = {
    title: req.title?.trim().slice(0, 120) || mod.plural,
    subtitle: `${records.length} record(s)${mixed ? ` · ${brands.length} brands` : ""}`,
    columns: keys.map((k) => ({ label: counts.get(k)?.label ?? "Brand", align: counts.get(k)?.right ? "right" : "left" })),
    rows: records.map((r) => keys.map((k) => value(r, k))),
    totals: [{ label: "Total records", value: String(records.length) }, ...(sum !== null ? [{ label: `Total ${counts.get(sumKey!)!.label.toLowerCase()}`, value: `₦ ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sum)}` }] : [])],
  };
  const options: PrintOptions = { paper: req.paper ?? "A4", orientation: landscape ? "landscape" : "portrait", watermark, printedBy: ctx.user.name, printedAt: new Date(), appUrl: appUrl() };
  const html = renderListHtml({ list, letterhead, options, toolbar: req.toolbar });
  let pdf: PdfResult | null = null;
  if (req.format === "pdf") {
    let engine: PdfEngine = "chromium";
    let bytes = await chromiumPdf(html, options);
    if (!bytes) {
      engine = "basic";
      bytes = await basicListPdf({ list, letterhead, options });
    }
    pdf = { bytes, fileName: `${safeName(list.title)}.pdf`, pages: await pageCount(bytes), engine, generatedId: null };
  }
  await audit({ ctx, action: "EXPORT", entity: "Print", entityId: `${mod.key}:list`, brandId: mixed ? null : (brands[0] ?? null), after: { module: mod.key, via: req.format === "pdf" ? "list-pdf" : "list-preview", letterhead: letterhead.code, records: records.length, ids: ids.slice(0, 50), pages: pdf?.pages } });
  return { html, pdf };
}

// ───────────────────────────── letterhead settings ─────────────────────────────

const letterheadSchema = z.object({
  legalEntity: z.string().trim().max(160).nullable(),
  rcNumber: z.string().trim().max(40).nullable(),
  address: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(60).nullable(),
  contactEmail: z.union([z.literal("").transform(() => null), z.string().trim().email().max(160), z.null()]),
  website: z.string().trim().max(160).nullable(),
  vatNumber: z.string().trim().max(40).nullable(),
  bankDetails: z.string().trim().max(1000).nullable(),
  color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("").transform(() => null), z.null()]),
  footerText: z.string().trim().max(200).nullable(),
  copyWatermark: z.boolean(),
});
export type LetterheadInput = z.input<typeof letterheadSchema>;

/** Brands whose letterhead the user may edit: every brand for administrators, the own brand(s) for Brand Admins. */
export async function letterheadBrands(ctx: AccessContext) {
  assertSetup(ctx, "letterhead");
  const scope = setupBrandIds(ctx);
  const rows = await store.brandLetterheadRows(scope === null ? ctx.brandIds : scope);
  return rows.filter((b) => b.status !== "INACTIVE").sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, code: b.code, name: b.name }));
}

export async function letterheadForEdit(ctx: AccessContext, brandId: string) {
  assertSetup(ctx, "letterhead");
  assertSetupBrand(ctx, brandId);
  const row = await store.letterheadEditRow(brandId);
  if (!row) throw new NotFoundError();
  return { ...row, hasLogo: !!row.logoMimeType };
}

export async function saveLetterhead(ctx: AccessContext, brandId: string, input: LetterheadInput) {
  assertSetup(ctx, "letterhead");
  assertSetupBrand(ctx, brandId);
  const data = letterheadSchema.parse(input);
  const before = await store.letterheadEditRow(brandId);
  if (!before) throw new NotFoundError();
  const brand = await store.updateLetterhead(brandId, data);
  await audit({ ctx, action: "UPDATE", entity: "Brand", entityId: brandId, brandId, before, after: { letterhead: data } });
  return brand;
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
export const MAX_LETTERHEAD_LOGO = 1024 * 1024;

export async function saveLetterheadLogo(ctx: AccessContext, brandId: string, file: { bytes: Uint8Array<ArrayBuffer>; type: string } | null) {
  assertSetup(ctx, "letterhead");
  assertSetupBrand(ctx, brandId);
  if (file) {
    if (!LOGO_TYPES.has(file.type)) throw new BadRequestError("The logo must be a PNG, JPEG or SVG file");
    if (file.bytes.byteLength > MAX_LETTERHEAD_LOGO) throw new BadRequestError("The logo must be 1 MB or smaller");
    if (file.type === "image/svg+xml" && /<script|on[a-z]+\s*=|javascript:/i.test(Buffer.from(file.bytes).toString("utf8"))) throw new BadRequestError("This SVG contains script and cannot be used as a logo");
  }
  const brand = await store.updateLetterhead(brandId, file ? { logoData: file.bytes, logoMimeType: file.type } : { logoData: null, logoMimeType: null });
  await audit({ ctx, action: "UPDATE", entity: "Brand", entityId: brandId, brandId, after: { logo: file ? `${file.type}, ${file.bytes.byteLength} bytes` : "removed" } });
  return brand;
}

// ───────────────────────────── template designer ─────────────────────────────

const templateMetaSchema = z.object({
  module: z.string().refine((m) => !!printModule(m), "Unknown module"),
  name: z.string().trim().min(2).max(80),
  brandId: z.string().min(1).nullable(),
  paper: z.enum(["A4", "LETTER", "A5"]),
  orientation: z.enum(["portrait", "landscape"]),
});

/** Brand scope of the designer: administrators design for every brand and for "all brands"; a Brand Admin only for the own brand(s). */
function assertTemplateScope(ctx: AccessContext, brandId: string | null) {
  assertSetup(ctx, "print-templates");
  if (brandId === null) {
    if (!ctx.isAdmin) throw new ForbiddenError("Templates for all brands are managed by administrators");
  } else assertSetupBrand(ctx, brandId);
}

export async function designerTemplates(ctx: AccessContext) {
  assertSetup(ctx, "print-templates");
  const scope = setupBrandIds(ctx);
  const rows = await store.printTemplates(scope === null ? {} : { OR: [{ brandId: null }, { brandId: { in: scope } }] });
  return rows.map((t) => ({ id: t.id, module: t.module, name: t.name, brandId: t.brandId, brandCode: t.brand?.code ?? null, paper: t.paper, orientation: t.orientation, isDefault: t.isDefault, version: t.version, active: t.active, hasDraft: t.draft !== null, editable: t.brandId === null ? ctx.isAdmin : scope === null || scope.includes(t.brandId), updatedAt: t.updatedAt }));
}

export async function designerTemplate(ctx: AccessContext, id: string) {
  assertSetup(ctx, "print-templates");
  const t = await store.printTemplate(id);
  if (!t) throw new NotFoundError();
  const scope = setupBrandIds(ctx);
  // another brand's template does not exist for a Brand Admin; an all-brand template is read-only for them
  if (t.brandId !== null && scope !== null && !scope.includes(t.brandId)) throw new NotFoundError();
  return { ...t, layout: parseLayout(t.layout), draft: t.draft === null ? null : parseLayout(t.draft), editable: t.brandId === null ? !!ctx.isAdmin : true };
}

/** A sample record of the module that the designer can see: the preview never shows more than the designer's own access. */
export async function sampleRecord(ctx: AccessContext, moduleKey: string, recordId?: string | null): Promise<PrintRecord | null> {
  const mod = moduleOrThrow(moduleKey);
  if (!hasPermission(ctx, mod.permission, "read")) return null;
  let id = recordId?.trim() || null;
  if (!id) {
    const model: Record<string, string> = { leads: "lead", contacts: "contact", accounts: "account", deals: "deal", quotes: "quote", salesOrders: "salesOrder", invoices: "invoice", activities: "activity", cases: "case", products: "product", priceBooks: "priceBook", campaigns: "campaign", inventoryDocuments: "inventoryDocument", vehicleUnits: "vehicleUnit" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic delegate access
    const row = await (scopedDb(ctx) as any)[model[mod.key]!].findFirst({ select: { id: true }, orderBy: { updatedAt: "desc" } });
    id = row?.id ?? null;
  }
  if (!id) return null;
  try {
    return await loadPrintRecord(ctx, mod.key, id);
  } catch {
    return null;
  }
}

/** A few recent records of a module the user can open (id and title) – to choose what a template is previewed with. */
export async function sampleChoices(ctx: AccessContext, moduleKey: string, take = 8): Promise<Array<{ id: string; title: string }>> {
  const mod = moduleOrThrow(moduleKey);
  if (!hasPermission(ctx, mod.permission, "read")) return [];
  const model: Record<string, string> = { leads: "lead", contacts: "contact", accounts: "account", deals: "deal", quotes: "quote", salesOrders: "salesOrder", invoices: "invoice", activities: "activity", cases: "case", products: "product", priceBooks: "priceBook", campaigns: "campaign", inventoryDocuments: "inventoryDocument", vehicleUnits: "vehicleUnit" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic delegate access
  const rows: Array<{ id: string }> = await (scopedDb(ctx) as any)[model[mod.key]!].findMany({ select: { id: true }, orderBy: { updatedAt: "desc" }, take });
  const out: Array<{ id: string; title: string }> = [];
  for (const r of rows) {
    const record = await loadPrintRecord(ctx, mod.key, r.id).catch(() => null);
    if (record) out.push({ id: record.id, title: record.number && !record.title.includes(record.number) ? `${record.number} – ${record.title}` : record.title });
  }
  return out;
}

/** What the designer offers for a module: its fields and related lists, read from a sample record. */
export async function designerCatalogue(ctx: AccessContext, moduleKey: string, recordId?: string | null) {
  assertSetup(ctx, "print-templates");
  const sample = await sampleRecord(ctx, moduleKey, recordId);
  return {
    sampleId: sample?.id ?? null,
    sampleTitle: sample?.title ?? null,
    fields: (sample?.fields ?? []).map((f) => ({ key: f.key, label: f.label })),
    lists: (sample?.tables ?? []).filter((t) => t.key !== "lines").map((t) => ({ key: t.key, label: t.title })),
    hasLines: !!sample?.lines,
    mergeFields: sample ? Object.entries(sample.merge).flatMap(([group, values]) => Object.keys(values).map((k) => `${group}.${k}`)).filter((f) => !f.startsWith("record.")).sort() : [],
    starter: sample ? defaultBuiltin(sample).layout(sample) : ({ blocks: [{ type: "letterhead" }, { type: "title", text: "{{record.name}}" }] } as PrintLayout),
  };
}

/** Live preview of a layout that is being designed (not saved, not audited as a print). */
export async function previewLayout(ctx: AccessContext, input: { module: string; layout: unknown; brandId: string | null; paper: Paper; orientation: Orientation; recordId?: string | null }): Promise<string> {
  assertSetup(ctx, "print-templates");
  const layout = cleanLayout(input.layout);
  const sample = await sampleRecord(ctx, input.module, input.recordId);
  const options: PrintOptions = { paper: input.paper, orientation: input.orientation, watermark: "PREVIEW", printedBy: ctx.user.name, printedAt: new Date(), appUrl: appUrl(), recordPath: (r) => moduleOrThrow(input.module).path(r.id) };
  if (!sample) {
    const lh = input.brandId && (setupBrandIds(ctx) === null || setupBrandIds(ctx)!.includes(input.brandId)) ? toLetterhead((await store.brandLetterheadRows([input.brandId]))[0]!) : await groupLetterhead();
    return renderListHtml({ list: { title: "No record to preview with", subtitle: "Create a record of this module, or enter the id of one you can open.", columns: [], rows: [], totals: [] }, letterhead: lh, options });
  }
  // the preview uses the sample record's brand letterhead, as a real print would
  const lh = await letterheadsFor(ctx, [sample], input.brandId && ctx.brandIds.includes(input.brandId) ? input.brandId : null);
  return renderRecordsHtml({ records: [sample], layout, letterheadFor: lh.of, options });
}

export async function createTemplate(ctx: AccessContext, input: z.input<typeof templateMetaSchema> & { layout: unknown }) {
  const meta = templateMetaSchema.parse(input);
  assertTemplateScope(ctx, meta.brandId);
  const layout = cleanLayout(input.layout);
  const t = await store.createPrintTemplate({ ...meta, layout: layout as object, draft: layout as object, version: 0, active: false, createdById: ctx.userId, updatedById: ctx.userId });
  await audit({ ctx, action: "CREATE", entity: "PrintTemplate", entityId: t.id, brandId: t.brandId, after: { module: t.module, name: t.name, paper: t.paper, orientation: t.orientation } });
  return t;
}

async function editable(ctx: AccessContext, id: string) {
  const t = await store.printTemplate(id);
  if (!t) throw new NotFoundError();
  const scope = setupBrandIds(ctx);
  if (t.brandId !== null && scope !== null && !scope.includes(t.brandId)) throw new NotFoundError();
  assertTemplateScope(ctx, t.brandId);
  return t;
}

/** Saves the designer's work without changing what people print with. */
export async function saveTemplateDraft(ctx: AccessContext, id: string, input: { name: string; paper: Paper; orientation: Orientation; layout: unknown }) {
  const t = await editable(ctx, id);
  const meta = templateMetaSchema.pick({ name: true, paper: true, orientation: true }).parse(input);
  const layout = cleanLayout(input.layout);
  await store.updatePrintTemplate(id, { ...meta, draft: layout as object, updatedById: ctx.userId });
  await audit({ ctx, action: "UPDATE", entity: "PrintTemplate", entityId: id, brandId: t.brandId, before: { name: t.name, paper: t.paper, orientation: t.orientation }, after: { ...meta, draft: "saved" } });
}

/** Publishes the draft: it becomes the layout people print with, as a new version. */
export async function publishTemplate(ctx: AccessContext, id: string) {
  const t = await editable(ctx, id);
  const layout = t.draft === null ? parseLayout(t.layout) : parseLayout(t.draft);
  const saved = await store.publishPrintTemplate(id, layout as object, ctx.userId);
  if (!t.active) await store.updatePrintTemplate(id, { active: true });
  await audit({ ctx, action: "UPDATE", entity: "PrintTemplate", entityId: id, brandId: t.brandId, before: { version: t.version }, after: { version: saved.version, published: true } });
  return saved.version;
}

/** Puts an earlier version back as the draft (publish to make it live). */
export async function revertTemplate(ctx: AccessContext, id: string, version: number) {
  const t = await editable(ctx, id);
  const v = await store.printTemplateVersion(id, version);
  if (!v) throw new NotFoundError();
  await store.updatePrintTemplate(id, { draft: v.layout as object, updatedById: ctx.userId });
  await audit({ ctx, action: "UPDATE", entity: "PrintTemplate", entityId: id, brandId: t.brandId, after: { revertedToVersion: version } });
}

export async function setTemplateFlags(ctx: AccessContext, id: string, flags: { isDefault?: boolean; active?: boolean }) {
  const t = await editable(ctx, id);
  if (flags.isDefault === true) {
    if (t.version === 0) throw new BadRequestError("Publish the template before making it the default");
    await store.setDefaultPrintTemplate(id, t.module, t.brandId);
  } else if (flags.isDefault === false) await store.updatePrintTemplate(id, { isDefault: false });
  if (flags.active !== undefined) await store.updatePrintTemplate(id, { active: flags.active && t.version > 0, ...(flags.active ? {} : { isDefault: false }) });
  await audit({ ctx, action: "UPDATE", entity: "PrintTemplate", entityId: id, brandId: t.brandId, after: flags });
}

export async function deleteTemplate(ctx: AccessContext, id: string) {
  const t = await editable(ctx, id);
  await store.deletePrintTemplate(id);
  await audit({ ctx, action: "DELETE", entity: "PrintTemplate", entityId: id, brandId: t.brandId, before: { module: t.module, name: t.name, version: t.version } });
}

export { PRINT_MODULES };

/**
 * Preview for the document-template builder: a sample (or chosen) record the user can open, on the letterhead a real
 * print of that record would use, with a layout compiled by the caller. Not saved; not a print.
 */
export async function previewCompiled(ctx: AccessContext, input: { module: string; brandId: string | null; recordId?: string | null; paper: Paper; orientation: Orientation; compile: (record: PrintRecord, lh: Letterhead) => PrintLayout }): Promise<{ html: string; record: PrintRecord | null; options: PrintOptions; layout: PrintLayout | null; letterhead: Letterhead }> {
  const mod = moduleOrThrow(input.module);
  const sample = await sampleRecord(ctx, input.module, input.recordId);
  const options: PrintOptions = { paper: input.paper, orientation: input.orientation, watermark: "PREVIEW", printedBy: ctx.user.name, printedAt: new Date(), appUrl: appUrl(), recordPath: (r) => mod.path(r.id) };
  if (!sample) {
    const row = input.brandId && ctx.brandIds.includes(input.brandId) ? (await store.brandLetterheadRows([input.brandId]))[0] : ctx.brandIds[0] ? (await store.brandLetterheadRows([ctx.brandIds[0]]))[0] : undefined;
    const lh = row ? toLetterhead(row) : await groupLetterhead();
    return { html: renderListHtml({ list: { title: "No record to preview with", subtitle: "Create a record of this module, or choose one you can open.", columns: [], rows: [], totals: [] }, letterhead: lh, options }), record: null, options, layout: null, letterhead: lh };
  }
  const lh = await letterheadsFor(ctx, [sample], input.brandId && ctx.brandIds.includes(input.brandId) ? input.brandId : null);
  const layout = input.compile(sample, lh.of(sample));
  options.pageLine = layout.pageLine ?? null;
  return { html: renderRecordsHtml({ records: [sample], layout, letterheadFor: lh.of, options }), record: sample, options, layout, letterhead: lh.of(sample) };
}

/** PDF of a preview (the builder's "Download test PDF"): same engines as a real print, watermarked PREVIEW, not stored. */
export async function previewPdf(html: string, p: { record: PrintRecord; layout: PrintLayout; letterhead: Letterhead; options: PrintOptions }): Promise<Uint8Array> {
  return (await chromiumPdf(html, p.options)) ?? (await basicRecordsPdf({ records: [p.record], layoutFor: () => p.layout, letterheadFor: () => p.letterhead, options: p.options }));
}
