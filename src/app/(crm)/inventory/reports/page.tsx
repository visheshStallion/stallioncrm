import Link from "next/link";
import { forbidden } from "next/navigation";
import { EmptyState, PageTitleRow } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { canSeeCost, isSalesView } from "@/server/modules/inventory/queries";
import { INV_REPORTS, runInvReport } from "@/server/modules/inventory/reports";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Inventory reports" };

export default async function InventoryReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; vin?: string; asOf?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (isSalesView(ctx)) forbidden();
  const cost = canSeeCost(ctx);
  const available = INV_REPORTS.filter((r) => (!r.finance || cost) && (!r.group || ctx.scope === "ALL"));
  const def = available.find((r) => r.key === sp.r) ?? available[0]!;
  const ui = await getUiFilters(ctx);
  const report = await runInvReport(ctx, def.key, { brandId: ui.brandId, vin: sp.vin, asOf: sp.asOf });
  const qs = new URLSearchParams({ ...(sp.vin ? { vin: sp.vin } : {}), ...(sp.asOf ? { asOf: sp.asOf } : {}), ...(ui.brandId ? { brandId: ui.brandId } : {}) }).toString();
  const fmt = (v: string | number | null) => (v === null ? "—" : typeof v === "number" ? v.toLocaleString("en-NG", { maximumFractionDigits: 2 }) : v);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <nav className="space-y-0.5 rounded-lg border border-border bg-surface p-2 text-[13px]" aria-label="Inventory reports" data-testid="inv-report-list">
        {available.map((r) => (
          <Link key={r.key} href={`/inventory/reports?r=${r.key}`} aria-current={r.key === def.key ? "page" : undefined} className={cn("block rounded px-2.5 py-1.5", r.key === def.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {r.title}
          </Link>
        ))}
      </nav>
      <div>
        <PageTitleRow
          title={report.title}
          left={<span className="text-[13px] text-text-muted">{report.rows.length} rows</span>}
          actions={
            hasPermission(ctx, "inventory", "export") ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/v1/inventory/reports/${def.key}${qs ? `?${qs}` : ""}`}>Export CSV</a>
              </Button>
            ) : null
          }
        />
        {def.param ? (
          <form method="get" className="mb-3 flex items-end gap-2">
            <input type="hidden" name="r" value={def.key} />
            {def.param === "vin" ? <Input name="vin" defaultValue={sp.vin ?? ""} placeholder="VIN" aria-label="VIN" className="h-8 w-56 font-mono" /> : <Input name="asOf" type="date" defaultValue={sp.asOf ?? ""} aria-label="As of date" className="h-8 w-44" />}
            <Button type="submit" size="sm" variant="outline">
              Show
            </Button>
          </form>
        ) : null}
        {report.note ? <p className="mb-2 text-xs text-text-muted">{report.note}</p> : null}
        {report.rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState title="Nothing to report" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[13px]" data-testid="inv-report">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                  {report.columns.map((c) => (
                    <th key={c} className="px-3 py-2">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, 1000).map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {row.map((v, j) => (
                      <td key={j} className={cn("px-3 py-1.5", typeof v === "number" && "text-right tabular-nums")}>
                        {fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
