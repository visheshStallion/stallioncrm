/**
 * Exports (prompt 12).
 *  • From any list view: CSV / XLSX of exactly what the caller's list shows – the rows come from the same list
 *    queries (scopedDb, customer tiers, field masks), so masked fields stay masked and hidden brands stay hidden.
 *  • Needs the module's export permission; every export is audited with user, module, filters and row count.
 *  • Up to EXPORT_SYNC_LIMIT rows are returned directly; larger exports run as a job and are offered as a
 *    download link that expires after 24 hours (owner only).
 *  • Full backup (all brands): administrators only, an encrypted zip of CSV files.
 */
import "server-only";
import type { Job } from "@prisma/client";
import { encryptBackup, MIN_PASSPHRASE } from "@/lib/backup-crypto";
import { toCsv } from "@/lib/csv";
import { toXlsx, zipStore } from "@/lib/xlsx";
import { assertCan } from "@/server/access/can";
import { loadAccessContext } from "@/server/access/context";
import { NotFoundError } from "@/server/access/errors";
import { fieldAccess, maskValue } from "@/server/access/field-mask";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { backupTables, expiredExports, markExportExpired } from "@/server/db/backup";
import { enqueueJob } from "@/server/db/jobs";
import { BadRequestError } from "@/server/errors";
import { listActivities } from "@/server/modules/activities/queries";
import { listCases } from "@/server/modules/cases/queries";
import { listProducts } from "@/server/modules/catalogue/queries";
import { listAccounts, listContacts } from "@/server/modules/customers/queries";
import { listDeals } from "@/server/modules/deals/queries";
import { listLeads } from "@/server/modules/leads/queries";
import { parseLeadFilters } from "@/server/modules/leads/schema";
import { notify } from "@/server/modules/notifications/service";
import { storage } from "@/server/storage";

export const EXPORT_SYNC_LIMIT = Number(process.env.EXPORT_SYNC_LIMIT ?? 2000);
export const EXPORT_MAX_ROWS = 100_000;
const EXPIRY_HOURS = 24;
const PAGE = 500;

type Cell = string | number | boolean | null | undefined;
type Row = Record<string, unknown>;
type Params = Record<string, string | undefined>;
interface Page {
  rows: object[];
  total: number;
}
interface ExportModule {
  key: ModuleKey;
  label: string;
  columns: Array<{ key: string; label: string }>;
  /** one page of the caller's list, with the same scoping and masking as the list view */
  page: (ctx: AccessContext, params: Params, take: number, skip: number) => Promise<Page>;
}

const col = (key: string, label: string) => ({ key, label });
const ui = (p: Params) => ({ brandId: p.brandId || null, regionId: p.regionId || null });

export const EXPORT_MODULES: ExportModule[] = [
  {
    key: "leads",
    label: "Leads",
    columns: [col("name", "Name"), col("mobile", "Mobile"), col("email", "Email"), col("city", "City"), col("brand", "Brand"), col("region", "Region"), col("source", "Source"), col("status", "Status"), col("rating", "Rating"), col("modelName", "Model"), col("budget", "Budget"), col("ownerName", "Owner"), col("createdAt", "Created")],
    page: (ctx, p, take, skip) => listLeads(ctx, parseLeadFilters(p), { take, skip }),
  },
  {
    key: "deals",
    label: "Deals",
    columns: [col("name", "Deal name"), col("customerName", "Customer"), col("accountName", "Account"), col("brand", "Brand"), col("region", "Region"), col("stageName", "Stage"), col("amount", "Amount"), col("closeDate", "Expected close"), col("modelName", "Model"), col("quantity", "Quantity"), col("paymentType", "Payment type"), col("discountPct", "Discount %"), col("vinChassisNo", "VIN"), col("ownerName", "Owner"), col("createdAt", "Created")],
    page: (ctx, p, take, skip) => listDeals(ctx, ui(p), { take, skip, where: p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { customerName: { contains: p.q, mode: "insensitive" } }] } : {} }),
  },
  {
    key: "accounts",
    label: "Accounts",
    columns: [col("name", "Account name"), col("type", "Type"), col("industry", "Industry"), col("city", "City"), col("state", "State"), col("phone", "Phone"), col("email", "Email"), col("address", "Address"), col("ownerName", "Owner"), col("createdAt", "Created")],
    page: (ctx, p, take, skip) => listAccounts(ctx, { q: p.q, take, skip }),
  },
  {
    key: "contacts",
    label: "Contacts",
    columns: [col("name", "Name"), col("accountName", "Account"), col("mobile", "Mobile"), col("email", "Email"), col("city", "City"), col("ownerName", "Owner"), col("createdAt", "Created")],
    page: (ctx, p, take, skip) => listContacts(ctx, { q: p.q, take, skip }),
  },
  {
    key: "cases",
    label: "Cases",
    columns: [col("number", "Case no."), col("subject", "Subject"), col("brand", "Brand"), col("region", "Region"), col("type", "Type"), col("priority", "Priority"), col("status", "Status"), col("customerName", "Customer"), col("slaDueAt", "Resolution due"), col("resolvedAt", "Resolved"), col("satisfactionScore", "Satisfaction"), col("ownerName", "Owner"), col("createdAt", "Created")],
    page: (ctx, p, take, skip) => listCases(ctx, { queue: p.queue ?? "all", q: p.q }, ui(p), { take, skip }),
  },
  {
    key: "activities",
    label: "Activities",
    columns: [col("subject", "Subject"), col("type", "Type"), col("status", "Status"), col("brand", "Brand"), col("region", "Region"), col("at", "Due / start"), col("parentType", "Related to"), col("outcome", "Outcome"), col("ownerName", "Owner")],
    page: (ctx, p, take, skip) => listActivities(ctx, { view: p.view ?? "all", type: p.type, q: p.q }, ui(p), { take, skip }),
  },
  {
    key: "products",
    label: "Products",
    columns: [col("code", "Code"), col("name", "Name"), col("brand", "Brand"), col("category", "Category"), col("model", "Model"), col("variant", "Variant"), col("modelYear", "Model year"), col("listPrice", "List price"), col("active", "Active")],
    page: (ctx, p, take, skip) => listProducts(ctx, { brandId: p.brandId, q: p.q, take, skip }),
  },
];
export const exportModule = (key: string) => EXPORT_MODULES.find((m) => m.key === key);

/**
 * Field-level security on top of what the list query already masked: profile field permissions also apply to
 * columns whose values the list returns unmasked (hidden → empty, masked → partially obscured).
 */
function cell(ctx: AccessContext, mod: ExportModule, key: string, value: unknown): Cell {
  const access = fieldAccess(ctx, mod.key, key);
  if (access === "hidden") return "";
  const v = access === "masked" && value !== null && value !== undefined && !String(value).includes("*") ? maskValue(key, value) : value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 16).replace("T", " ") : String(v);
}

async function collect(ctx: AccessContext, mod: ExportModule, params: Params, limit: number): Promise<{ rows: Cell[][]; total: number }> {
  const db = scopedDb(ctx);
  const [brands, regions] = await Promise.all([db.brand.findMany({ select: { id: true, code: true } }), db.region.findMany({ select: { id: true, name: true } })]);
  const brand = new Map(brands.map((b) => [b.id, b.code]));
  const region = new Map(regions.map((r) => [r.id, r.name]));
  const out: Cell[][] = [];
  let total = 0;
  for (let skip = 0; skip < limit; skip += PAGE) {
    const page = await mod.page(ctx, params, Math.min(PAGE, limit - skip), skip);
    total = page.total;
    for (const r of page.rows as Row[]) out.push(mod.columns.map((c) => cell(ctx, mod, c.key, c.key === "brand" ? brand.get(String(r.brandId)) : c.key === "region" ? region.get(String(r.regionId)) : r[c.key])));
    if (page.rows.length < PAGE || out.length >= total) break;
  }
  return { rows: out, total };
}

function render(mod: ExportModule, format: "csv" | "xlsx", rows: Cell[][]): { body: Uint8Array; contentType: string; ext: string } {
  const headers = mod.columns.map((c) => c.label);
  if (format === "xlsx") return { body: toXlsx(mod.label, headers, rows.map((r) => r.map((v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : v)))), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  return { body: new TextEncoder().encode("﻿" + toCsv(headers, rows)), contentType: "text/csv; charset=utf-8", ext: "csv" };
}

const clean = (params: Params): Params => Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== "format").map(([k, v]) => [k, String(v).slice(0, 200)]));
const fileName = (mod: ExportModule, ext: string) => `${mod.key}-${new Date().toISOString().slice(0, 10)}.${ext}`;

export type ExportResult = { kind: "file"; fileName: string; contentType: string; body: Uint8Array; rows: number } | { kind: "job"; jobId: string; rows: number };

/**
 * Export of a list view. Small results come back as a file; larger ones are queued and the caller gets a
 * notification with a download link when the file is ready.
 */
export async function exportList(ctx: AccessContext, moduleKey: string, format: string, rawParams: Params): Promise<ExportResult> {
  const mod = exportModule(moduleKey);
  if (!mod) throw new BadRequestError("This module cannot be exported");
  assertCan(ctx, mod.key, "export");
  const fmt = format === "xlsx" ? "xlsx" : "csv";
  const params = clean(rawParams);
  const { total } = await mod.page(ctx, params, 1, 0);
  if (total > EXPORT_MAX_ROWS) throw new BadRequestError(`This export has ${total} rows – narrow the filters (maximum ${EXPORT_MAX_ROWS})`);
  if (total > EXPORT_SYNC_LIMIT) {
    const job = await scopedDb(ctx).exportJob.create({ data: { userId: ctx.userId, module: mod.key, format: fmt, params }, select: { id: true } });
    await enqueueJob({ type: "export.run", payload: { exportId: job.id, userId: ctx.userId }, idempotencyKey: `export:${job.id}`, maxAttempts: 2 });
    await audit({ ctx, action: "EXPORT", entity: mod.label, after: { module: mod.key, format: fmt, filters: params, rows: total, queued: job.id } });
    return { kind: "job", jobId: job.id, rows: total };
  }
  const { rows } = await collect(ctx, mod, params, EXPORT_SYNC_LIMIT);
  const file = render(mod, fmt, rows);
  await audit({ ctx, action: "EXPORT", entity: mod.label, after: { module: mod.key, format: fmt, filters: params, rows: rows.length } });
  return { kind: "file", fileName: fileName(mod, file.ext), contentType: file.contentType, body: file.body, rows: rows.length };
}

/** Job handler "export.run": builds the file with the requester's CURRENT access and stores it for 24 hours. */
export async function runExport(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { exportId, userId } = job.payload as { exportId: string; userId: string };
  const ctx = await loadAccessContext(userId);
  if (!ctx) return { skipped: "the user is no longer active" };
  const db = scopedDb(ctx);
  const row = await db.exportJob.findUnique({ where: { id: exportId } });
  if (!row || row.status !== "QUEUED") return { skipped: "export is not queued" };
  const mod = exportModule(row.module)!;
  await db.exportJob.update({ where: { id: exportId }, data: { status: "RUNNING" } });
  try {
    assertCan(ctx, mod.key, "export");
    const { rows } = await collect(ctx, mod, row.params as Params, EXPORT_MAX_ROWS);
    const file = render(mod, row.format === "xlsx" ? "xlsx" : "csv", rows);
    const storageKey = `exports/${userId}/${exportId}.${file.ext}`;
    await storage().put(storageKey, file.body, file.contentType);
    await db.exportJob.update({ where: { id: exportId }, data: { status: "DONE", rowCount: rows.length, storageKey, fileName: fileName(mod, file.ext), finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPIRY_HOURS * 3_600_000) } });
    await notify(ctx, [userId], { kind: "INFO", title: `Your ${mod.label} export is ready`, body: `${rows.length} rows · the link expires in ${EXPIRY_HOURS} hours`, href: "/exports" });
    return { rows: rows.length };
  } catch (err) {
    await db.exportJob.update({ where: { id: exportId }, data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
}

export async function listExports(ctx: AccessContext) {
  const rows = await scopedDb(ctx).exportJob.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 30 });
  const now = Date.now();
  return rows.map((r) => ({ ...r, available: r.status === "DONE" && !!r.expiresAt && r.expiresAt.getTime() > now, expired: r.status === "DONE" && !!r.expiresAt && r.expiresAt.getTime() <= now }));
}

/** Download of a finished export: its owner only (RLS), until it expires – then the file is removed. */
export async function downloadExport(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const row = await db.exportJob.findFirst({ where: { id, userId: ctx.userId } });
  if (!row || row.status !== "DONE" || !row.storageKey) throw new NotFoundError();
  if (!row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
    await storage().delete(row.storageKey).catch(() => undefined);
    await db.exportJob.update({ where: { id }, data: { status: "EXPIRED", storageKey: null } });
    throw new NotFoundError();
  }
  await audit({ ctx, action: "EXPORT", entity: "ExportJob", entityId: id, after: { downloaded: true, rows: row.rowCount } });
  return { fileName: row.fileName ?? "export", contentType: row.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : row.format === "pdf" ? "application/pdf" : row.format === "zip" ? "application/zip" : "text/csv; charset=utf-8", body: await storage().get(row.storageKey) };
}

/** Scheduler: removes the files of expired exports. */
export async function purgeExpiredExports(): Promise<number> {
  let n = 0;
  for (const e of await expiredExports()) {
    await storage().delete(e.storageKey).catch(() => undefined);
    await markExportExpired(e.id);
    n++;
  }
  return n;
}

/**
 * Full backup of every brand's data – administrators only. One CSV per table inside a zip, encrypted with
 * AES-256-GCM from the administrator's passphrase (see src/lib/backup-crypto.ts). Secrets (password hashes) are
 * never included. Audited.
 */
export async function fullBackup(ctx: AccessContext, passphrase: string): Promise<{ fileName: string; body: Uint8Array; tables: number; rows: number }> {
  if (!ctx.isAdmin) throw new NotFoundError();
  if (passphrase.length < MIN_PASSPHRASE) throw new BadRequestError(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters`);
  const tables = await backupTables();
  const enc = new TextEncoder();
  let rows = 0;
  const files = tables.map((t) => {
    rows += t.rows.length;
    return { name: `${t.name}.csv`, data: enc.encode("﻿" + toCsv(t.columns, t.rows)) };
  });
  files.push({ name: "README.txt", data: enc.encode(`StallionCRM full backup\nCreated: ${new Date().toISOString()}\nBy: ${ctx.user.email}\nTables: ${tables.length}\nRows: ${rows}\n`) });
  const body = encryptBackup(zipStore(files), passphrase);
  await audit({ ctx, action: "EXPORT", entity: "Backup", after: { tables: tables.length, rows, bytes: body.byteLength } });
  return { fileName: `stallioncrm-backup-${new Date().toISOString().slice(0, 10)}.zip.enc`, body, tables: tables.length, rows };
}
