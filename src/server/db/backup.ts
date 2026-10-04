/**
 * System-side reads for the administrator's full backup and export housekeeping (prompt 12). The backup spans
 * every brand, so it cannot go through a scoped client; the caller (exports/service.ts) checks that the user
 * is an administrator and audits the export.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

/** Business tables in the backup. Technical tables (jobs, audit, sessions, outbox) and secrets are left out. */
const TABLES = [
  "Brand", "BrandCodeAlias", "Region", "Territory", "TerritoryMember", "Role", "Profile", "User",
  "Account", "Contact", "ContactBrandConsent", "CustomerBrandLink", "Lead", "Deal", "DealStageHistory", "Pipeline", "PipelineStage",
  "Product", "PriceBook", "PriceBookEntry", "VehicleStockRef", "Quote", "SalesOrder", "Invoice", "DocumentLine", "Payment",
  "Activity", "TestDrive", "Note", "Case", "SlaPolicy", "Solution", "Campaign", "CampaignMember", "Template", "Message",
  "ApprovalRequest", "Target", "Report", "CustomField", "Layout",
];
const SECRET_COLUMNS = new Set(["passwordHash", "logoData", "surveyToken", "unsubscribeToken"]);
const PAGE = 5000;

export interface BackupTable {
  name: string;
  columns: string[];
  rows: unknown[][];
}

const plain = (v: unknown): unknown => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return "";
  if (typeof v === "object") return typeof (v as { toFixed?: unknown }).toFixed === "function" ? String(v) : JSON.stringify(v);
  return v;
};

export async function backupTables(): Promise<BackupTable[]> {
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  const out: BackupTable[] = [];
  for (const name of TABLES) {
    const model = models.get(name);
    if (!model) continue; // table of a module that is not installed
    const columns = model.fields.filter((f) => (f.kind === "scalar" || f.kind === "enum") && !SECRET_COLUMNS.has(f.name)).map((f) => f.name);
    const list = Prisma.raw(columns.map((c) => `"${c}"`).join(", "));
    const order = Prisma.raw(model.fields.some((f) => f.name === "id") ? `"id"` : "1");
    const rows: unknown[][] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await unsafeDb.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT ${list} FROM ${Prisma.raw(`"${name}"`)} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${offset}`);
      for (const r of page) rows.push(columns.map((c) => plain(r[c])));
      if (page.length < PAGE) break;
    }
    out.push({ name, columns, rows });
  }
  return out;
}

export function expiredExports(now = new Date()): Promise<Array<{ id: string; storageKey: string }>> {
  return unsafeDb.exportJob.findMany({ where: { status: "DONE", storageKey: { not: null }, expiresAt: { lte: now } }, select: { id: true, storageKey: true }, take: 200 }) as Promise<Array<{ id: string; storageKey: string }>>;
}

export async function markExportExpired(id: string): Promise<void> {
  await unsafeDb.exportJob.update({ where: { id }, data: { status: "EXPIRED", storageKey: null } });
}
