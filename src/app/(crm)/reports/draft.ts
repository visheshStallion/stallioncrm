import { reportModule } from "@/server/modules/reports/catalog";
import type { ReportRow } from "@/server/modules/reports/service";
import type { ReportDraft } from "./ReportBuilder";

/** Builder state for a new report, or for editing a saved one. */
export function toDraft(report?: ReportRow): ReportDraft {
  const mod = reportModule(report?.module ?? "deals")!;
  const d = report?.definition;
  return {
    id: report?.id,
    name: report?.name ?? "",
    description: report?.description ?? "",
    folder: report?.folder ?? "PRIVATE",
    brandId: report?.brandId ?? "",
    module: mod.key,
    columns: d?.columns.length ? d.columns : mod.defaultColumns,
    filters: (d?.filters ?? []).map((f) => ({ field: f.field, op: f.op, value: f.value === null || f.value === undefined ? "" : String(f.value) })),
    dateField: d?.dateRange?.field ?? "createdAt",
    datePreset: d?.dateRange?.preset ?? "ALL",
    from: d?.dateRange?.from ?? "",
    to: d?.dateRange?.to ?? "",
    groupBy: d?.groupBy ?? [],
    summaries: d?.summaries.length ? d.summaries : [{ fn: "count" }],
    chart: d?.chart.type ?? "bar",
    sortField: d?.sort?.field ?? mod.defaultSort,
    sortDir: d?.sort?.dir ?? "desc",
  };
}
