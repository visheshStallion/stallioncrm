import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { Pagination } from "@/components/crm/ListPage";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { parsePaging } from "@/server/list/filters";
import { canSeeCost, listUnits, listWarehouses } from "@/server/modules/inventory/queries";
import { AGEING_BUCKETS, STATUS_LABELS, VEHICLE_STATUSES } from "@/server/modules/inventory/status";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { STATUS_TONE } from "../tones";

export const metadata = { title: "Vehicle stock" };
type SP = { q?: string; status?: string; productId?: string; warehouseId?: string; colour?: string; year?: string; ageing?: string; view?: string; page?: string; per?: string };

/**
 * Vehicle stock list. Sales users see the "Available to sell" view: available units of their brands and the
 * units of their own deals, VIN masked until reserved, never a cost column.
 */
export default async function UnitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [ui, dir] = await Promise.all([getUiFilters(ctx), getDirectory(ctx)]);
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const [{ rows, total, salesView }, warehouses, products] = await Promise.all([
    listUnits(ctx, { ...sp, brandId: ui.brandId }, { take: paging.per, skip: paging.skip }),
    listWarehouses(ctx, ui.brandId),
    hasPermission(ctx, "products", "read") ? scopedDb(ctx).product.findMany({ where: { trackingType: "SERIAL", ...(ui.brandId ? { brandId: ui.brandId } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const cost = canSeeCost(ctx);
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  return (
    <div>
      <PageTitleRow
        title={salesView ? (sp.view === "mine" ? "My reserved units" : "Available to sell") : "Vehicle stock"}
        left={
          <span className="text-[13px] text-text-muted" data-testid="total-records">
            {total}
          </span>
        }
      />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2" data-testid="unit-filters">
        {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={salesView ? "Last 6 of the VIN" : "VIN, model or plate"} aria-label="Search stock" className="h-8 w-52" />
        <Select name="productId" defaultValue={sp.productId ?? ""} aria-label="Model" className="h-8">
          <option value="">All models</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input name="colour" defaultValue={sp.colour ?? ""} placeholder="Colour" aria-label="Colour" className="h-8 w-28" />
        <Input name="year" defaultValue={sp.year ?? ""} placeholder="Year" aria-label="Model year" className="h-8 w-20" inputMode="numeric" />
        {salesView ? null : (
          <>
            <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8">
              <option value="">All statuses</option>
              {VEHICLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select name="warehouseId" defaultValue={sp.warehouseId ?? ""} aria-label="Warehouse" className="h-8">
              <option value="">All locations</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Select name="ageing" defaultValue={sp.ageing ?? ""} aria-label="Ageing" className="h-8">
              <option value="">Any age</option>
              {AGEING_BUCKETS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </Select>
          </>
        )}
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No vehicles match" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="units-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">VIN</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Colour</th>
                <th className="px-3 py-2">Year</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Status</th>
                {salesView ? null : <th className="px-3 py-2 text-right">Age (days)</th>}
                <th className="px-3 py-2 text-right">Price</th>
                {cost ? <th className="px-3 py-2 text-right">Cost</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0" data-testid="data-row">
                  <td className="px-3 py-2">{brand(u.brandId) ? <BrandBadge brand={brand(u.brandId)!} /> : null}</td>
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/inventory/units/${u.id}`} className="text-primary hover:underline">
                      {u.vin}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{u.productName}</td>
                  <td className="px-3 py-2">{u.colour ?? "—"}</td>
                  <td className="px-3 py-2">{u.modelYear ?? "—"}</td>
                  <td className="px-3 py-2">{u.warehouseName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={STATUS_TONE[u.status]}>{u.statusLabel}</StatusPill>
                  </td>
                  {salesView ? null : <td className="px-3 py-2 text-right tabular-nums">{u.ageDays ?? "—"}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(u.sellingPrice)}</td>
                  {cost ? <td className="px-3 py-2 text-right tabular-nums">{formatMoney(u.totalCost)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </div>
  );
}
