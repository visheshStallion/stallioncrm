import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow } from "@/components/crm/primitives";
import { formatMoney } from "@/lib/format";
import { stockDashboard } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Inventory" };

function Bars({ title, rows, href }: { title: string; rows: Array<{ label: string; n: number; href?: string }>; href?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-2 text-[13px] font-semibold">{href ? <Link href={href}>{title}</Link> : title}</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-muted">Nothing to show.</p>
      ) : (
        <ul className="space-y-1.5 text-[13px]">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2">
              <div>
                <div className="truncate">{r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label}</div>
                <div className="mt-0.5 h-1.5 rounded bg-muted">
                  <div className="h-1.5 rounded bg-primary" style={{ width: `${(r.n / max) * 100}%` }} />
                </div>
              </div>
              <span className="text-right font-semibold tabular-nums">{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stock dashboard: the brand selected in the brand switcher, or all brands the user can see. */
export default async function InventoryDashboard() {
  const ctx = await requireContext();
  const [ui, dir] = await Promise.all([getUiFilters(ctx), getDirectory(ctx)]);
  const d = await stockDashboard(ctx, ui.brandId);
  const brand = dir.brands.find((b) => b.id === ui.brandId);
  const kpi = (label: string, value: number | string, href?: string) => (
    <div className="rounded-lg border border-border bg-surface px-4 py-3" data-testid="stock-kpi">
      <div className="text-[11px] font-semibold uppercase text-text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{href ? <Link href={href}>{value}</Link> : value}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <PageTitleRow title={d.salesView ? "Stock you can sell" : "Stock dashboard"} left={<span className="text-[13px] text-text-muted">{brand ? brand.name : "all your brands"}</span>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpi("Available", d.available, "/inventory/units?view=available")}
        {d.salesView ? null : kpi("In stock", d.inStock)}
        {d.salesView ? null : kpi("Reserved / allocated", d.reserved, "/inventory/units?status=RESERVED")}
        {d.salesView ? null : kpi("On the way", d.pipeline)}
        {d.salesView ? null : kpi("At port / clearing", d.atPort, "/inventory/units?status=AT_PORT")}
      </div>
      {d.value ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="stock-value">
          <h2 className="mb-2 text-[13px] font-semibold">Stock value at cost (vehicles in stock, per legal entity)</h2>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
            {d.value.map((v) => {
              const b = dir.brands.find((x) => x.id === v.brandId);
              return (
                <li key={v.brandId} className="flex items-center gap-2">
                  {b ? <BrandBadge brand={b} /> : null}
                  <span className="font-semibold tabular-nums">{formatMoney(v.value)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {d.salesView ? null : <Bars title="Units by status" rows={d.byStatus.map((s) => ({ label: s.label, n: s.n, href: `/inventory/units?status=${s.status}` }))} />}
        <Bars title="By model" rows={d.byModel} />
        <Bars title="By colour" rows={d.byColour} />
        {d.salesView ? null : <Bars title="By location" rows={d.byWarehouse} />}
        {d.salesView ? null : <Bars title="Ageing of stock" rows={d.ageing.map((a) => ({ label: a.label, n: a.n, href: `/inventory/units?ageing=${a.key}` }))} />}
        {d.salesView ? null : (
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="reorder-alerts">
            <h2 className="mb-2 text-[13px] font-semibold">
              <Link href="/inventory/parts?reorder=1">Reorder alerts (parts)</Link>
            </h2>
            {d.reorder.length === 0 ? (
              <p className="text-[13px] text-text-muted">No part is below its reorder level.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {d.reorder.slice(0, 8).map((r) => (
                  <li key={`${r.productId}${r.warehouseId}${r.batchNo}`} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums font-semibold text-[#b3262b] dark:text-danger">
                      {r.qty} / {r.reorderLevel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
