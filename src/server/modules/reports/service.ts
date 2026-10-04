/**
 * Saved reports (prompt 09): folders (Private / Brand / Group), standard reports, running and exporting.
 * Sharing only decides who can OPEN a definition (RLS on "Report"); the data always comes from `runReport`
 * with the VIEWER's access context.
 */
import "server-only";
import { toCsv } from "@/lib/csv";
import { toXlsx } from "@/lib/xlsx";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { definitionSchema, reportSchema, type ReportDefinition } from "./definition";
import { MAX_EXPORT_ROWS, runReport, type ReportResult, type RunOptions } from "./engine";

export interface ReportRow {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  module: string;
  folder: "PRIVATE" | "BRAND" | "GROUP";
  brandId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  standard: boolean;
  mine: boolean;
  definition: ReportDefinition;
  updatedAt: string;
}

const select = { id: true, key: true, name: true, description: true, module: true, folder: true, brandId: true, ownerId: true, owner: { select: { name: true } }, definition: true, updatedAt: true } as const;

function toRow(ctx: AccessContext, r: { id: string; key: string | null; name: string; description: string | null; module: string; folder: "PRIVATE" | "BRAND" | "GROUP"; brandId: string | null; ownerId: string | null; owner: { name: string } | null; definition: unknown; updatedAt: Date }): ReportRow {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    module: r.module,
    folder: r.folder,
    brandId: r.brandId,
    ownerId: r.ownerId,
    ownerName: r.owner?.name ?? null,
    standard: r.ownerId === null,
    mine: r.ownerId === ctx.userId,
    definition: definitionSchema.parse(r.definition),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Reports the viewer may open: their own, their brands' folders, the group folder and the standard reports. */
export async function listReports(ctx: AccessContext): Promise<ReportRow[]> {
  assertCan(ctx, "reports", "read");
  const rows = await scopedDb(ctx).report.findMany({ select, orderBy: [{ name: "asc" }], take: 500 });
  return rows.map((r) => toRow(ctx, r));
}

/** 404 for missing reports and for reports in folders the viewer cannot open. */
export async function getReport(ctx: AccessContext, idOrKey: string): Promise<ReportRow> {
  assertCan(ctx, "reports", "read");
  const r = await scopedDb(ctx).report.findFirst({ where: { OR: [{ id: idOrKey }, { key: idOrKey }] }, select });
  if (!r) throw new NotFoundError();
  return toRow(ctx, r);
}

function assertFolder(ctx: AccessContext, folder: string, brandId: string | null) {
  if (folder === "BRAND") {
    if (!brandId) throw new BadRequestError("Choose the brand to share the report with");
    if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new ForbiddenError("You can only share with your own brands");
  }
}

export async function createReport(ctx: AccessContext, input: unknown) {
  assertCan(ctx, "reports", "create");
  const data = reportSchema.parse(input);
  assertFolder(ctx, data.folder, data.brandId);
  return scopedDb(ctx).report.create({
    data: { name: data.name, description: data.description, module: data.definition.module, definition: data.definition, folder: data.folder, brandId: data.folder === "BRAND" ? data.brandId : null, ownerId: ctx.userId },
    select: { id: true },
  });
}

/** Only the owner edits a report; standard reports are read-only (clone them instead). */
export async function updateReport(ctx: AccessContext, id: string, input: unknown) {
  assertCan(ctx, "reports", "edit");
  const current = await getReport(ctx, id);
  if (!current.mine) throw new ForbiddenError(current.standard ? "Standard reports cannot be changed – save a copy" : "Only the owner can change this report");
  const data = reportSchema.parse(input);
  assertFolder(ctx, data.folder, data.brandId);
  await scopedDb(ctx).report.update({
    where: { id: current.id },
    data: { name: data.name, description: data.description, module: data.definition.module, definition: data.definition, folder: data.folder, brandId: data.folder === "BRAND" ? data.brandId : null },
    select: { id: true },
  });
  return { id: current.id };
}

export async function deleteReport(ctx: AccessContext, id: string) {
  const current = await getReport(ctx, id);
  if (!current.mine) throw new ForbiddenError("Only the owner can delete this report");
  await scopedDb(ctx).report.delete({ where: { id: current.id } });
}

/** Opens and runs a saved report – with the viewer's access context, whoever owns or shared it. */
export async function runSavedReport(ctx: AccessContext, idOrKey: string, opts: RunOptions = {}): Promise<{ report: ReportRow; result: ReportResult }> {
  const report = await getReport(ctx, idOrKey);
  return { report, result: await runReport(ctx, report.definition, opts) };
}

export const canExportReports = (ctx: AccessContext) => hasPermission(ctx, "reports", "export");

const display = (v: string | number | null, type: string): string | number | null => (typeof v === "string" && type === "date" ? v.slice(0, 10) : v);

/**
 * CSV / XLSX export – only for profiles with the export permission (Sales Exec: 403). Audited with the row
 * count. The exported rows are exactly what the viewer sees on screen (same engine, same access context).
 */
export async function exportReport(ctx: AccessContext, idOrKey: string, format: "csv" | "xlsx", opts: RunOptions = {}): Promise<{ fileName: string; contentType: string; body: Uint8Array }> {
  assertCan(ctx, "reports", "export");
  const { report, result } = await runSavedReport(ctx, idOrKey, { ...opts, take: MAX_EXPORT_ROWS, skip: 0 });
  const headers = result.columns.map((c) => c.label);
  const rows = result.rows.map((r) => r.map((v, i) => display(v, result.columns[i]!.type)));
  await audit({ ctx, action: "EXPORT", entity: "Report", entityId: report.id, after: { name: report.name, format, rows: rows.length, brandId: opts.brandId ?? null, regionId: opts.regionId ?? null } });
  const base = `${report.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "report"}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "xlsx") {
    return { fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: toXlsx(report.name, headers, rows) };
  }
  return { fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", body: new TextEncoder().encode("﻿" + toCsv(headers, rows)) };
}
