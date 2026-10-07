import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { canUseVendors } from "./data";

export const metadata = { title: "Vendors" };

/** Vendors module: the vendors of the user's brands (the brand switcher narrows it), search by name, e-mail or phone. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string; inactive?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canUseVendors(ctx)) forbidden();
  const [dir, ui] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const q = (sp.q ?? "").trim();
  const rows = await scopedDb(ctx).vendor.findMany({
    where: {
      ...(ui.brandId ? { brandId: ui.brandId } : {}),
      ...(sp.inactive ? {} : { active: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { category: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, brandId: true, name: true, type: true, phone: true, email: true, category: true, glAccount: true, city: true, active: true, ownerId: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  const owners = new Map((await scopedDb(ctx).user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitleRow title="Vendors" left={<span className="text-[13px] text-text-muted">{rows.length} vendor(s)</span>} />
        {hasPermission(ctx, "inventory", "create") ? (
          <Link href="/vendors/new" className="crm-btn crm-btn-primary" data-testid="new-vendor">
            Create Vendor
          </Link>
        ) : null}
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Name, e-mail, phone or category" aria-label="Search vendors" className="crm-input h-8 w-72" />
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> Include inactive
        </label>
        <button type="submit" className="crm-btn crm-btn-secondary">
          Search
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" data-testid="vendor-list">
          <thead className="border-b border-border text-left text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2">Vendor Name</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">GL Account</th>
              <th className="px-3 py-2">City</th>
              <th className="px-3 py-2">Vendor Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-border last:border-0" data-testid="data-row">
                <td className="px-3 py-2">
                  <Link href={`/vendors/${v.id}`} className="font-medium text-primary hover:underline">
                    {v.name}
                  </Link>
                  {v.active ? null : <span className="ml-2 text-xs text-text-muted">inactive</span>}
                </td>
                <td className="px-3 py-2">{brand(v.brandId) ? <BrandBadge brand={brand(v.brandId)!} /> : null}</td>
                <td className="px-3 py-2">{v.phone ?? "—"}</td>
                <td className="px-3 py-2">{v.email ?? "—"}</td>
                <td className="px-3 py-2">{v.category ?? "—"}</td>
                <td className="px-3 py-2">{v.glAccount ?? "—"}</td>
                <td className="px-3 py-2">{v.city ?? "—"}</td>
                <td className="px-3 py-2">{v.ownerId ? (owners.get(v.ownerId) ?? "—") : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                  No vendor found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
