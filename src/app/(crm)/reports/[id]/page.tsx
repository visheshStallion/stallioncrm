import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Chart } from "@/components/charts";
import { Pagination } from "@/components/crm/ListPage";
import { PrintPageButton } from "@/components/crm/PrintActions";
import { PrintLetterhead } from "@/components/crm/PrintLetterhead";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { ReportTable } from "@/components/crm/ReportTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { parsePaging } from "@/server/list/filters";
import { getPreferences } from "@/server/modules/preferences/queries";
import { cloneReportAction, deleteReportAction } from "@/server/modules/reports/actions";
import { DATE_PRESETS, PRESET_LABELS, reportModule } from "@/server/modules/reports/catalog";
import { chartData } from "@/server/modules/reports/engine";
import { canExportReports, runSavedReport } from "@/server/modules/reports/service";
import { getUiFilters, requireContext } from "@/server/request";

type SP = { preset?: string; from?: string; to?: string; page?: string; per?: string };
const FOLDER: Record<string, string> = { PRIVATE: "Private", BRAND: "Brand folder", GROUP: "Group folder" };

/** Runs a saved report with the VIEWER's access context (whoever built or shared it). */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!hasPermission(ctx, "reports", "read")) forbidden();
  const [ui, prefs] = await Promise.all([getUiFilters(ctx), getPreferences(ctx)]);
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const preset = DATE_PRESETS.includes(sp.preset as never) ? sp.preset! : undefined;
  const { report, result } = await runSavedReport(ctx, id, {
    brandId: ui.brandId,
    regionId: ui.regionId,
    take: paging.per,
    skip: paging.skip,
    ...(preset ? { dateRange: { preset, from: sp.from, to: sp.to } } : {}),
  }).catch((e) => {
    if (isAccessError(e)) notFound(); // missing, or in a folder the viewer cannot open
    throw e;
  });
  const def = report.definition;
  const mod = reportModule(report.module);
  const currentPreset = preset ?? def.dateRange?.preset ?? "ALL";
  const chartType = def.chart.type;
  const valueIndex = result.columns.slice(result.groupCount).findIndex((c) => c.type === "money");
  const chart = result.kind === "summary" && chartType !== "none" ? chartData(result, Math.max(0, valueIndex)) : null;
  const format = result.columns[result.groupCount + Math.max(0, valueIndex)]?.type === "money" ? "money" : "number";
  const query = new URLSearchParams(Object.entries({ preset: preset ?? "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v));
  const exportHref = (f: string) => `/api/v1/reports/${report.id}/export?format=${f}${query.size ? `&${query}` : ""}`;
  const links = result.kind === "tabular" && mod?.path ? result.ids!.map((rid) => `${mod.path}/${rid}`) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PrintLetterhead ctx={ctx} title={`Report: ${report.name}`} />
      <PageTitleRow
        title={report.name}
        left={
          <>
            <StatusPill>{report.standard ? "Standard" : FOLDER[report.folder]}</StatusPill>
            <span className="text-xs text-text-muted">{mod?.label}</span>
          </>
        }
        actions={
          <>
            <PrintPageButton />
            {canExportReports(ctx) ? (
              <>
                <Button asChild variant="outline">
                  <a href={exportHref("csv")} data-testid="export-csv">
                    Export CSV
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={exportHref("xlsx")} data-testid="export-xlsx">
                    Export XLSX
                  </a>
                </Button>
              </>
            ) : null}
            {report.mine ? (
              <Button asChild>
                <Link href={`/reports/${report.id}/edit`} data-shortcut="edit">
                  Edit
                </Link>
              </Button>
            ) : hasPermission(ctx, "reports", "create") && !def.special ? (
              <ActionForm action={cloneReportAction}>
                <input type="hidden" name="id" value={report.id} />
                <SubmitButton variant="outline">Save a copy</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />
      {report.description ? <p className="mb-3 text-[13px] text-text-muted">{report.description}</p> : null}
      <p className="mb-3 text-xs text-text-muted" data-testid="report-scope">
        This report shows the records you are allowed to see{report.mine ? "" : report.standard ? "" : ` (shared by ${report.ownerName})`}.
      </p>
      {def.dateRange ? (
        <form method="get" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 text-[13px]" data-testid="report-period">
          <label htmlFor="preset" className="font-semibold">
            Period
          </label>
          <Select id="preset" name="preset" defaultValue={currentPreset}>
            {DATE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </Select>
          <Input type="date" name="from" defaultValue={sp.from ?? def.dateRange.from ?? ""} aria-label="From (custom range)" className="w-40" />
          <Input type="date" name="to" defaultValue={sp.to ?? def.dateRange.to ?? ""} aria-label="To (custom range)" className="w-40" />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      ) : null}
      {chart && chart.categories.length ? (
        <section className="mb-3 rounded-lg border border-border bg-surface p-4">
          <Chart type={chartType as "bar" | "line" | "pie" | "funnel"} title={report.name} categories={chart.categories} series={chart.series} format={format} />
        </section>
      ) : null}
      <section className="rounded-lg border border-border bg-surface">
        <ReportTable columns={result.columns} rows={result.rows} links={links} dateFormat={prefs.dateFormat} />
      </section>
      {result.kind === "tabular" ? (
        <Pagination total={result.total} page={paging.page} per={paging.per} />
      ) : result.truncated ? (
        <p className="mt-2 text-xs text-text-muted">Showing the first {result.rows.length} groups – add filters to narrow the report.</p>
      ) : null}
      {report.mine ? (
        <ActionForm action={deleteReportAction} confirm="Delete this report?" className="mt-4 text-right">
          <input type="hidden" name="id" value={report.id} />
          <SubmitButton size="sm" variant="ghost">
            Delete report
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
