/**
 * Import wizard (prompt 12): upload → mapping → dry run → commit as a background job → history with undo.
 *
 *  • The file is parsed in memory; its rows live in `ImportJob.data` only until the job has run.
 *  • The plan (plan.ts) is computed with the IMPORTER's access: brands they may write to, records they can see.
 *    A Brand Manager's row for another brand is a row error; administrators may import into any brand.
 *  • The job runs with the importer's own access context through the normal services / scopedDb, so every
 *    record passes the same validation, brand isolation and audit as manual entry.
 *  • Undo soft-deletes the records the import created (updates are not reverted).
 */
import "server-only";
import { Prisma, type Job } from "@prisma/client";
import { parseCsv } from "@/lib/csv";
import { readXlsx } from "@/lib/xlsx-read";
import { managedBrands } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { loadAccessContext } from "@/server/access/context";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { BadRequestError } from "@/server/errors";
import { createActivity } from "@/server/modules/activities/service";
import { createPriceBook, createProduct, updateProduct, upsertEntry } from "@/server/modules/catalogue/service";
import { createAccount, createContact, updateAccount, updateContact } from "@/server/modules/customers/service";
import { createDeal, updateDeal } from "@/server/modules/deals/service";
import { createLead, updateLead } from "@/server/modules/leads/service";
import { autoMapColumns, existingKey, importModule, MAX_IMPORT_ROWS, planImport, type ImportLookups, type ImportMapping, type ImportModule, type ImportPlan, type PlanRow } from "./plan";

/* eslint-disable @typescript-eslint/no-explicit-any -- import targets are handled generically */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Who may import: profiles with import.create. Administrators into any brand, everyone else into brands they manage. */
export function importBrandIds(ctx: AccessContext): string[] {
  return ctx.isAdmin ? ctx.brandIds : managedBrands(ctx);
}
export function canImport(ctx: AccessContext): boolean {
  return hasPermission(ctx, "import", "create") && (ctx.isAdmin || managedBrands(ctx).length > 0);
}
function assertImporter(ctx: AccessContext) {
  assertCan(ctx, "import", "create");
  if (!canImport(ctx)) throw new ForbiddenError("Imports are for administrators and Brand Managers");
}

/** Parses an uploaded CSV / XLSX file into rows (header first). */
export function parseUpload(fileName: string, bytes: Uint8Array): string[][] {
  if (bytes.byteLength === 0) throw new BadRequestError("The file is empty");
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new BadRequestError("Files can be at most 5 MB");
  let rows: string[][];
  try {
    rows = /\.xlsx$/i.test(fileName) ? readXlsx(bytes, MAX_IMPORT_ROWS + 1) : parseCsv(new TextDecoder("utf-8").decode(bytes));
  } catch (err) {
    throw new BadRequestError(`The file could not be read: ${err instanceof Error ? err.message : "unknown format"}`);
  }
  if (rows.length < 2) throw new BadRequestError("The file needs a header row and at least one data row");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestError(`A file can have at most ${MAX_IMPORT_ROWS} rows`);
  const header = rows[0]!.map((h) => h.trim());
  if (new Set(header.filter(Boolean)).size !== header.filter(Boolean).length) throw new BadRequestError("The header row has duplicate column names");
  return [header, ...rows.slice(1)];
}

const emptyMapping = (mod: ImportModule, header: string[]): ImportMapping => ({ columns: autoMapColumns(mod, header), values: {}, dedupe: "skip", defaultBrand: null, defaultRegion: null });

/** Step 1: upload. Creates a draft import with the parsed rows and an automatic column mapping. */
export async function createImport(ctx: AccessContext, moduleKey: string, file: { name: string; bytes: Uint8Array }) {
  assertImporter(ctx);
  const mod = importModule(moduleKey);
  if (!mod) throw new BadRequestError("Unknown import module");
  const rows = parseUpload(file.name, file.bytes);
  const job = await scopedDb(ctx).importJob.create({
    data: { module: mod.key, fileName: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 150), userId: ctx.userId, data: rows, mapping: emptyMapping(mod, rows[0]!) as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });
  return job;
}

export async function getImport(ctx: AccessContext, id: string) {
  const job = await scopedDb(ctx).importJob.findUnique({ where: { id }, include: { user: { select: { name: true } }, _count: { select: { records: true } } } });
  if (!job) throw new NotFoundError();
  return job;
}

/** The importer's lookups: only brands they may write to, and (for dedupe) only records they can see. */
async function buildLookups(ctx: AccessContext, mod: ImportModule, rows: string[][], mapping: ImportMapping): Promise<ImportLookups> {
  const db = scopedDb(ctx);
  const [brands, aliases, regions, users, stages, products] = await Promise.all([
    db.brand.findMany({ select: { id: true, code: true, name: true, status: true } }),
    db.brandCodeAlias.findMany({ select: { alias: true, brand: { select: { code: true } } } }),
    db.region.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.user.findMany({ where: { active: true }, select: { id: true, email: true } }),
    mod.key === "deals" ? db.pipelineStage.findMany({ where: { pipeline: { isDefault: true } }, select: { id: true, key: true, name: true, pipeline: { select: { brand: { select: { code: true } } } } } }) : [],
    ["leads", "deals", "priceBooks"].includes(mod.key) ? db.product.findMany({ select: { id: true, code: true, name: true, brand: { select: { code: true } } } }) : [],
  ]);
  const allowed = new Set(importBrandIds(ctx));
  const brandAliases: Record<string, string> = {};
  for (const b of brands) {
    brandAliases[b.code.toUpperCase()] = b.code;
    brandAliases[b.name.toUpperCase()] = b.code;
  }
  for (const a of aliases) brandAliases[a.alias.toUpperCase()] = a.brand.code;
  const stageMap: ImportLookups["stages"] = {};
  for (const s of stages as Array<{ id: string; key: string; name: string; pipeline: { brand: { code: string } } }>) {
    const m = (stageMap[s.pipeline.brand.code] ??= {});
    m[s.key.toUpperCase()] = s.id;
    m[s.name.toUpperCase()] = s.id;
    m[s.name.toUpperCase().replace(/[\s-]+/g, "_")] = s.id;
  }
  const productMap: ImportLookups["products"] = {};
  for (const p of products as Array<{ id: string; code: string; name: string; brand: { code: string } }>) {
    const m = (productMap[p.brand.code] ??= {});
    m[p.code.toUpperCase()] = p.id;
    m[p.name.toUpperCase()] = p.id;
  }
  const lookups: ImportLookups = {
    brandAliases,
    brands: Object.fromEntries(brands.map((b) => [b.code, { id: b.id, status: b.status }])),
    allowedBrands: new Set(brands.filter((b) => allowed.has(b.id)).map((b) => b.code)),
    regions: Object.fromEntries(regions.map((r) => [r.name.toLowerCase(), r.id])),
    users: Object.fromEntries(users.map((u) => [u.email.toLowerCase(), u.id])),
    stages: stageMap,
    products: productMap,
    existing: {},
  };
  // Dedupe index: plan once without it to learn the candidate keys, then look those up.
  const probe = planImport(mod, rows, { ...mapping, dedupe: "create" }, lookups);
  const brandCode = (id: string) => brands.find((b) => b.id === id)?.code ?? null;
  for (const key of mod.dedupeKeys) {
    const wanted = [...new Set(probe.rows.map((r) => r.values[key]).filter((v): v is string => typeof v === "string" && v !== ""))];
    if (!wanted.length) continue;
    const chunk = (n: number) => Array.from({ length: Math.ceil(wanted.length / n) }, (_, i) => wanted.slice(i * n, i * n + n));
    for (const values of chunk(500)) {
      if (mod.key === "leads") for (const r of await db.lead.findMany({ where: { [key]: { in: values } }, select: { id: true, brandId: true, [key]: true } as any })) lookups.existing[existingKey(brandCode((r as any).brandId), key, String((r as any)[key]))] = (r as any).id;
      if (mod.key === "deals") for (const r of await db.deal.findMany({ where: { name: { in: values, mode: "insensitive" } }, select: { id: true, brandId: true, name: true } })) lookups.existing[existingKey(brandCode(r.brandId), key, r.name)] = r.id;
      if (mod.key === "accounts") for (const r of await db.account.findMany({ where: { deletedAt: null, name: { in: values, mode: "insensitive" } }, select: { id: true, name: true } })) lookups.existing[existingKey(null, key, r.name)] = r.id;
      if (mod.key === "contacts") for (const r of await db.contact.findMany({ where: { deletedAt: null, [key]: { in: values } }, select: { id: true, [key]: true } as any })) lookups.existing[existingKey(null, key, String((r as any)[key]))] = (r as any).id;
      if (mod.key === "products") for (const r of await db.product.findMany({ where: { code: { in: values.map((v) => v.toUpperCase()) } }, select: { id: true, code: true, brandId: true } })) lookups.existing[existingKey(brandCode(r.brandId), key, r.code)] = r.id;
    }
  }
  return lookups;
}

function readMapping(mod: ImportModule, header: string[], raw: unknown): ImportMapping {
  const m = (raw ?? {}) as Partial<ImportMapping>;
  const columns: Record<string, string> = {};
  for (const h of header) {
    const key = m.columns?.[h] ?? "";
    columns[h] = mod.fields.some((f) => f.key === key) ? key : "";
  }
  const values: ImportMapping["values"] = {};
  for (const [field, map] of Object.entries(m.values ?? {})) {
    if (!mod.fields.some((f) => f.key === field) || typeof map !== "object" || !map) continue;
    values[field] = Object.fromEntries(Object.entries(map).slice(0, 200).map(([from, to]) => [from.trim().toLowerCase(), String(to).slice(0, 200)]));
  }
  return { columns, values, dedupe: m.dedupe === "update" || m.dedupe === "create" ? m.dedupe : "skip", defaultBrand: m.defaultBrand || null, defaultRegion: m.defaultRegion || null };
}

/** Step 2 / 3: save the mapping and return the dry-run report. Nothing is written to the CRM. */
export async function dryRun(ctx: AccessContext, id: string, mapping?: unknown): Promise<{ plan: ImportPlan; mapping: ImportMapping; header: string[] }> {
  assertImporter(ctx);
  const job = await getImport(ctx, id);
  if (job.userId !== ctx.userId) throw new ForbiddenError("Only the importer can change this import");
  if (job.status !== "DRAFT" || !job.data) throw new BadRequestError("This import was already started");
  const mod = importModule(job.module)!;
  const rows = job.data as string[][];
  const m = readMapping(mod, rows[0]!, mapping ?? job.mapping);
  if (mapping !== undefined) await scopedDb(ctx).importJob.update({ where: { id }, data: { mapping: m as unknown as Prisma.InputJsonValue } });
  return { plan: planImport(mod, rows, m, await buildLookups(ctx, mod, rows, m)), mapping: m, header: rows[0]! };
}

/** Step 4: commit. Queues the background job; the dry run must have no missing required columns. */
export async function commitImport(ctx: AccessContext, id: string) {
  const { plan } = await dryRun(ctx, id);
  if (plan.missingRequired.length) throw new BadRequestError(`Map the required columns first: ${plan.missingRequired.join(", ")}`);
  if (plan.summary.create + plan.summary.update === 0) throw new BadRequestError("There is nothing to import – every row is skipped or has errors");
  await scopedDb(ctx).importJob.update({ where: { id }, data: { status: "QUEUED" } });
  await enqueueJob({ type: "import.run", payload: { importId: id, userId: ctx.userId }, idempotencyKey: `import:${id}`, maxAttempts: 1 });
  await audit({ ctx, action: "IMPORT", entity: "ImportJob", entityId: id, after: { queued: true, ...plan.summary } });
  return plan.summary;
}

// ───────────────────────────── the job ─────────────────────────────

async function applyRow(ctx: AccessContext, mod: ImportModule, row: PlanRow): Promise<{ model: string; id: string } | null> {
  const v = row.values as Record<string, any>;
  const { brandId, regionId, ownerId, stageId, productId } = row.ids;
  const db = scopedDb(ctx);
  switch (mod.key) {
    case "leads": {
      const data = { firstName: v.firstName, lastName: v.lastName, mobile: v.mobile, email: v.email, city: v.city, source: v.source, rating: v.rating, budget: v.budget, modelOfInterestId: productId };
      if (row.action === "update") return void (await updateLead(ctx, row.existingId!, { ...data, ...(v.status ? { status: v.status } : {}) } as never)), { model: "Lead", id: row.existingId! };
      const lead = await createLead(ctx, { ...data, status: v.status === "UNQUALIFIED" ? "NEW" : v.status, brandId: brandId!, regionId: regionId!, ownerId: ownerId ?? ctx.userId } as never);
      return { model: "Lead", id: lead.id };
    }
    case "accounts": {
      const data = { name: v.name, type: v.type, phone: v.phone, email: v.email, industry: v.industry, city: v.city, state: v.state, address: v.address, website: v.website };
      if (row.action === "update") return void (await updateAccount(ctx, row.existingId!, data as never)), { model: "Account", id: row.existingId! };
      return { model: "Account", id: (await createAccount(ctx, data as never)).id };
    }
    case "contacts": {
      const account = v.accountName ? await db.account.findFirst({ where: { deletedAt: null, name: { equals: v.accountName, mode: "insensitive" } }, select: { id: true } }) : null;
      const data = { firstName: v.firstName, lastName: v.lastName, mobile: v.mobile, altPhone: v.altPhone, email: v.email, city: v.city, address: v.address, accountId: account?.id };
      if (row.action === "update") return void (await updateContact(ctx, row.existingId!, data as never)), { model: "Contact", id: row.existingId! };
      return { model: "Contact", id: (await createContact(ctx, data as never)).id };
    }
    case "deals": {
      const account = v.accountName ? await db.account.findFirst({ where: { deletedAt: null, name: { equals: v.accountName, mode: "insensitive" } }, select: { id: true } }) : null;
      const contact = v.contactEmail ? await db.contact.findFirst({ where: { deletedAt: null, email: { equals: v.contactEmail, mode: "insensitive" } }, select: { id: true } }) : null;
      const data = { name: v.name, amount: v.amount, closeDate: v.closeDate, quantity: v.quantity, paymentType: v.paymentType, lossReason: v.lossReason, modelId: productId, accountId: account?.id, contactId: contact?.id, customerName: v.accountName };
      let id = row.existingId;
      if (row.action === "update") await updateDeal(ctx, id!, data as never);
      else id = (await createDeal(ctx, { ...data, brandId: brandId!, regionId: regionId!, ownerId: ownerId ?? ctx.userId } as never)).id;
      // Historic stage of a migrated deal: set directly (the Blueprint governs moves made in the CRM, not imports).
      if (stageId) await db.deal.update({ where: { id: id! }, data: { stageId }, select: { id: true } });
      return { model: "Deal", id: id! };
    }
    case "products": {
      const data = { code: v.code, model: v.model, variant: v.variant, category: v.category ?? "VEHICLE", modelYear: v.modelYear, listPrice: v.listPrice, description: v.description, active: true };
      if (row.action === "update") return void (await updateProduct(ctx, row.existingId!, data as never)), { model: "Product", id: row.existingId! };
      return { model: "Product", id: (await createProduct(ctx, brandId!, data as never)).id };
    }
    case "priceBooks": {
      const product = await db.product.findFirst({ where: { brandId: brandId!, code: String(v.productCode).toUpperCase() }, select: { id: true } });
      if (!product) throw new BadRequestError(`Product ${v.productCode} does not exist in ${row.brand}`);
      let book = await db.priceBook.findFirst({ where: { brandId: brandId!, name: { equals: v.priceBook, mode: "insensitive" } }, select: { id: true } });
      if (!book) book = await createPriceBook(ctx, brandId!, { name: v.priceBook, validFrom: new Date().toISOString().slice(0, 10), active: true, isDefault: false } as never);
      await upsertEntry(ctx, book.id, { productId: product.id, price: v.price, maxDiscountPct: v.maxDiscountPct ?? "" });
      return { model: "PriceBook", id: book.id };
    }
    case "activities": {
      const deal = v.dealName ? await db.deal.findFirst({ where: { name: { equals: v.dealName, mode: "insensitive" }, ...(brandId ? { brandId } : {}) }, select: { id: true } }) : null;
      const lead = !deal && v.leadMobile ? await db.lead.findFirst({ where: { mobile: v.leadMobile, ...(brandId ? { brandId } : {}) }, select: { id: true } }) : null;
      if (!deal && !lead) throw new BadRequestError("The related deal / lead was not found (or is not visible to you)");
      const type = v.type ?? "TASK";
      const start = v.dueAt ? new Date(`${v.dueAt}T09:00:00+01:00`) : new Date();
      const a = await createActivity(ctx, {
        type,
        parentType: deal ? "Deal" : "Lead",
        parentId: (deal ?? lead)!.id,
        subject: v.subject,
        description: v.description,
        ...(type === "MEETING" ? { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString() } : { dueAt: start.toISOString() }),
        completed: v.status === "COMPLETED",
        ownerId: ownerId ?? undefined,
      } as never);
      return { model: "Activity", id: a.id };
    }
  }
}

/**
 * Job handler "import.run": re-plans with the importer's CURRENT access (rights may have changed since the dry
 * run) and writes row by row. A failing row is reported and does not stop the others. The uploaded rows are
 * deleted when the job ends.
 */
export async function runImport(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { importId, userId } = job.payload as { importId: string; userId: string };
  const ctx = await loadAccessContext(userId);
  if (!ctx) return { skipped: "the importer is no longer an active user" };
  const db = scopedDb(ctx);
  const row = await db.importJob.findUnique({ where: { id: importId } });
  if (!row || row.status !== "QUEUED" || !row.data) return { skipped: "import is not queued" };
  await db.importJob.update({ where: { id: importId }, data: { status: "RUNNING", startedAt: new Date() } });
  const mod = importModule(row.module)!;
  const summary = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, byBrand: {} as Record<string, number> };
  const problems: Array<{ line: number; message: string }> = [];
  try {
    if (!canImport(ctx)) throw new ForbiddenError("The importer may no longer import");
    const rows = row.data as string[][];
    const mapping = readMapping(mod, rows[0]!, row.mapping);
    const plan = planImport(mod, rows, mapping, await buildLookups(ctx, mod, rows, mapping));
    summary.total = plan.rows.length;
    for (const r of plan.rows) {
      if (r.errors.length) {
        summary.failed++;
        problems.push({ line: r.line, message: r.errors.join("; ") });
        continue;
      }
      if (r.action === "skip") {
        summary.skipped++;
        continue;
      }
      try {
        const res = await applyRow(ctx, mod, r);
        if (res) await db.importRecord.create({ data: { importId, model: res.model, recordId: res.id, action: r.action === "update" ? "UPDATED" : "CREATED" } });
        if (r.action === "update") summary.updated++;
        else summary.created++;
        summary.byBrand[r.brand ?? "–"] = (summary.byBrand[r.brand ?? "–"] ?? 0) + 1;
      } catch (err) {
        summary.failed++;
        problems.push({ line: r.line, message: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      }
    }
    await db.importJob.update({ where: { id: importId }, data: { status: "DONE", finishedAt: new Date(), summary, problems: problems.slice(0, 1000), data: Prisma.JsonNull } });
  } catch (err) {
    await db.importJob.update({ where: { id: importId }, data: { status: "FAILED", finishedAt: new Date(), summary, problems: [{ line: 0, message: (err instanceof Error ? err.message : String(err)).slice(0, 300) }], data: Prisma.JsonNull } });
  }
  await audit({ ctx, action: "IMPORT", entity: "ImportJob", entityId: importId, after: summary });
  return summary;
}
// ───────────────────────────── history, undo, saved mappings ─────────────────────────────

export async function listImports(ctx: AccessContext, take = 50) {
  assertImporter(ctx);
  return scopedDb(ctx).importJob.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, module: true, fileName: true, status: true, summary: true, createdAt: true, finishedAt: true, undoneAt: true, userId: true, user: { select: { name: true } }, _count: { select: { records: true } } } });
}

const DELEGATE: Record<string, string> = { Lead: "lead", Deal: "deal", Account: "account", Contact: "contact", Activity: "activity", Product: "product" };

/**
 * Undo: soft-deletes the records CREATED by the import (products are deactivated; price book entries and
 * updates are not reverted). Only the importer; records that others can no longer see are left alone.
 */
export async function undoImport(ctx: AccessContext, id: string) {
  assertImporter(ctx);
  const job = await getImport(ctx, id);
  if (job.userId !== ctx.userId) throw new ForbiddenError("Only the importer can undo an import");
  if (job.status !== "DONE") throw new BadRequestError("Only finished imports can be undone");
  const db = scopedDb(ctx) as any;
  const records = await db.importRecord.findMany({ where: { importId: id, action: "CREATED" } });
  let removed = 0;
  for (const model of Object.keys(DELEGATE)) {
    const ids = records.filter((r: { model: string }) => r.model === model).map((r: { recordId: string }) => r.recordId);
    if (!ids.length) continue;
    const res = model === "Product" ? await db.product.updateMany({ where: { id: { in: ids } }, data: { active: false } }) : await db[DELEGATE[model]!].updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
    removed += res.count;
  }
  await db.importJob.update({ where: { id }, data: { status: "UNDONE", undoneAt: new Date() } });
  await audit({ ctx, action: "DELETE", entity: "ImportJob", entityId: id, after: { undone: true, removed } });
  return { removed };
}

export async function discardImport(ctx: AccessContext, id: string) {
  const job = await getImport(ctx, id);
  if (job.userId !== ctx.userId) throw new ForbiddenError("Only the importer can discard this import");
  if (job.status !== "DRAFT") throw new BadRequestError("Only draft imports can be discarded");
  await scopedDb(ctx).importJob.delete({ where: { id } });
}

export async function listMappings(ctx: AccessContext, moduleKey: string) {
  return scopedDb(ctx).importMapping.findMany({ where: { module: moduleKey }, orderBy: { name: "asc" }, select: { id: true, name: true, shared: true, userId: true, mapping: true } });
}

/** Saves the current mapping of an import as a template (e.g. "Zoho Deals export"). */
export async function saveMapping(ctx: AccessContext, importId: string, name: string, shared: boolean) {
  assertImporter(ctx);
  const job = await getImport(ctx, importId);
  const title = name.trim().slice(0, 80);
  if (!title) throw new BadRequestError("Name the mapping");
  const data = { mapping: job.mapping as Prisma.InputJsonValue, shared: shared && ctx.isAdmin };
  return scopedDb(ctx).importMapping.upsert({ where: { userId_module_name: { userId: ctx.userId, module: job.module, name: title } }, update: data, create: { ...data, name: title, module: job.module, userId: ctx.userId }, select: { id: true } });
}

/** Applies a saved mapping to a draft import (columns that do not exist in this file are ignored). */
export async function applyMapping(ctx: AccessContext, importId: string, mappingId: string) {
  const saved = await scopedDb(ctx).importMapping.findUnique({ where: { id: mappingId } });
  if (!saved) throw new NotFoundError();
  return dryRun(ctx, importId, saved.mapping);
}
