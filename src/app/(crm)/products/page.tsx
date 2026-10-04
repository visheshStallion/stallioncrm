import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { CreateSplitButton, FilterPanel, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { EmptyState, StatusPill } from "@/components/crm/primitives";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { managedBrands } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { conditionsToWhere, parseConditions, parsePaging } from "@/server/list/filters";
import { listProducts, productFilterFields } from "@/server/modules/catalogue/queries";
import { CATEGORY_LABELS } from "@/server/modules/catalogue/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Products" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "products", "read")) forbidden();
  const [dir, ui] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const fields = productFilterFields(dir.myBrands);
  const conditions = parseConditions(sp.f, fields);
  const viewId = one(sp.view) === "all" ? "all" : "active";
  const layout = one(sp.layout) === "list" ? "list" : "grid";
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) ?? "20" });
  const { rows, total } = await listProducts(ctx, {
    brandId: ui.brandId,
    q: one(sp.q),
    activeOnly: viewId === "active",
    where: conditionsToWhere(conditions, fields),
    take: paging.per,
    skip: paging.skip,
  });
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  const canCreate = hasPermission(ctx, "products", "create") && (ctx.scope === "ALL" || managedBrands(ctx).length > 0);
  const layoutHref = (l: string) => {
    const p = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])) as string[][]);
    if (l === "grid") p.delete("layout");
    else p.set("layout", l);
    return `/products?${p.toString()}`;
  };

  return (
    <ModuleListFrame
      title={
        <ViewSelector
          current={viewId}
          views={[
            { id: "active", name: "Active Products", group: "system" },
            { id: "all", name: "All Products", group: "system" },
          ]}
        />
      }
      actions={
        <>
          {canCreate ? <CreateSplitButton label="Create Product" href="/products/new" /> : null}
          <div className="flex overflow-hidden rounded-md border border-border bg-surface text-[13px]" role="group" aria-label="Layout">
            <Link href={layoutHref("grid")} aria-current={layout === "grid" ? "page" : undefined} className={cn("px-2.5 py-1.5", layout === "grid" ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}>
              Grid
            </Link>
            <Link href={layoutHref("list")} aria-current={layout === "list" ? "page" : undefined} className={cn("px-2.5 py-1.5", layout === "list" ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}>
              List
            </Link>
          </div>
        </>
      }
      filters={<FilterPanel fields={fields} conditions={conditions} systemFilters={[]} searchPlaceholder="Model, variant or code" />}
    >
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No products found" text="Products are limited to the brands you work in." />
        </div>
      ) : layout === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="product-grid">
          {rows.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className="rounded-lg border border-border bg-surface p-3 hover:border-primary/50" data-testid="product-card">
              <div className="mb-2 flex h-28 items-center justify-center overflow-hidden rounded bg-muted">
                {p.imageUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- catalogue images are external URLs
                  <img src={p.imageUrls[0]} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-text-muted">No image</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <BrandBadge brand={brand(p.brandId)} />
                {!p.active ? <StatusPill tone="warning">Inactive</StatusPill> : null}
              </div>
              <div className="mt-1 font-semibold">{p.name}</div>
              <div className="text-xs text-text-muted">
                {p.code} · {CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS]}
                {p.modelYear ? ` · ${p.modelYear}` : ""}
              </div>
              <div className="mt-1 tabular-nums">{formatMoney(p.listPrice)}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="crm-table w-full">
            <thead className="bg-muted text-left text-[12px] text-text-muted">
              <tr>
                {["Product", "Brand", "Code", "Category", "Year", "Body", "List price", "Status"].map((h) => (
                  <th key={h} className="h-9 px-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/60" data-testid="data-row">
                  <td className="px-3">
                    <Link href={`/products/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3">
                    <BrandBadge brand={brand(p.brandId)} />
                  </td>
                  <td className="px-3">{p.code}</td>
                  <td className="px-3">{CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS]}</td>
                  <td className="px-3">{p.modelYear ?? "—"}</td>
                  <td className="px-3">{p.bodyType ?? "—"}</td>
                  <td className="px-3 tabular-nums">{formatMoney(p.listPrice)}</td>
                  <td className="px-3">{p.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </ModuleListFrame>
  );
}
