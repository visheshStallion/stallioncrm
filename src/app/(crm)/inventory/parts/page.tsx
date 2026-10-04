import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { saveItemStockAction } from "@/server/modules/inventory/actions";
import { canSeeCost, isSalesView, listStockBalances } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Parts & accessories" };

/** Quantity stock of parts and accessories with reorder points; a draft purchase order can be started from the alerts. */
export default async function PartsPage({ searchParams }: { searchParams: Promise<{ reorder?: string }> }) {
  const { reorder } = await searchParams;
  const ctx = await requireContext();
  if (isSalesView(ctx)) forbidden();
  const [ui, dir] = await Promise.all([getUiFilters(ctx), getDirectory(ctx)]);
  const rows = await listStockBalances(ctx, { brandId: ui.brandId, reorderOnly: reorder === "1" });
  const cost = canSeeCost(ctx);
  const canEdit = hasPermission(ctx, "inventory", "edit");
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  return (
    <div>
      <PageTitleRow
        title="Parts & accessories"
        left={<span className="text-[13px] text-text-muted">{rows.length} stock lines</span>}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={reorder === "1" ? "/inventory/parts" : "/inventory/parts?reorder=1"}>{reorder === "1" ? "Show all" : "Below reorder level"}</Link>
            </Button>
            {hasPermission(ctx, "inventory", "create") ? (
              <Button asChild size="sm">
                <Link href="/inventory/documents/new?type=PO">New purchase order</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title={reorder === "1" ? "No part is below its reorder level" : "No parts in stock"} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="parts-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Warehouse</th>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2 text-right">On hand</th>
                {cost ? <th className="px-3 py-2 text-right">Value</th> : null}
                <th className="px-3 py-2">Reorder level / order qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.productId}|${r.warehouseId}|${r.batchNo}`} className="border-b border-border last:border-0" data-testid="data-row">
                  <td className="px-3 py-2">{brand(r.brandId) ? <BrandBadge brand={brand(r.brandId)!} /> : null}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">
                    <Link href={`/products/${r.productId}`} className="text-primary hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.warehouseName}</td>
                  <td className="px-3 py-2">{r.batchNo || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.qty}
                    {r.belowReorder ? (
                      <StatusPill tone="danger" className="ml-2">
                        reorder
                      </StatusPill>
                    ) : null}
                  </td>
                  {cost ? <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.value)}</td> : null}
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <ActionForm action={saveItemStockAction} className="flex items-center gap-1">
                        <input type="hidden" name="productId" value={r.productId} />
                        <Input name="reorderLevel" type="number" min={0} step="0.01" defaultValue={r.reorderLevel ?? ""} aria-label={`Reorder level of ${r.name}`} className="h-7 w-20 text-right" />
                        <Input name="reorderQty" type="number" min={0} step="0.01" defaultValue={r.reorderQty ?? ""} aria-label={`Order quantity of ${r.name}`} className="h-7 w-20 text-right" />
                        <SubmitButton size="sm" variant="ghost">
                          Save
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      `${r.reorderLevel ?? "—"} / ${r.reorderQty ?? "—"}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
