import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { formatDate } from "@/lib/format";
import { canManageBrandData } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { listPriceBooks } from "@/server/modules/catalogue/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Price Books" };

export default async function PriceBooksPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "priceBooks", "read")) forbidden();
  const [dir, ui, prefs] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx)]);
  const books = await listPriceBooks(ctx, ui.brandId);
  const manageable = dir.brands.filter((b) => b.status !== "INACTIVE" && canManageBrandData(ctx, "priceBooks", "create", b.id));
  const brand = (id: string) => dir.brands.find((b) => b.id === id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitleRow title="Price Books" left={<span className="text-[13px] text-text-muted">{books.length} price book(s) of your brands</span>} />
        {manageable.length ? (
          <div className="flex gap-2">
            <Link href="/priceBooks/import" className="crm-btn crm-btn-secondary" data-testid="import-price-books">
              Import
            </Link>
            <Link href="/priceBooks/new" className="crm-btn crm-btn-primary" data-testid="new-price-book">
              Create Price Book
            </Link>
          </div>
        ) : null}
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-surface">
        <table className="crm-table w-full">
          <thead className="bg-muted text-left text-[12px] text-text-muted">
            <tr>
              {["Price book", "Brand", "Valid from", "Valid to", "Products", "Status"].map((h) => (
                <th key={h} className="h-9 px-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} className="border-t border-border hover:bg-muted/60" data-testid="data-row">
                <td className="px-3">
                  <Link href={`/priceBooks/${b.id}`} className="font-medium text-primary hover:underline">
                    {b.name}
                  </Link>
                </td>
                <td className="px-3">
                  <BrandBadge brand={brand(b.brandId)} />
                </td>
                <td className="px-3">{formatDate(b.validFrom, prefs.dateFormat)}</td>
                <td className="px-3">{b.validTo ? formatDate(b.validTo, prefs.dateFormat) : "open-ended"}</td>
                <td className="px-3">{b.entryCount}</td>
                <td className="px-3">
                  <span className="flex gap-1">
                    {b.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                    <StatusPill tone={b.validToday ? "success" : "neutral"}>{!b.active ? "Inactive" : b.validToday ? "Valid today" : "Not valid today"}</StatusPill>
                  </span>
                </td>
              </tr>
            ))}
            {books.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  No price books for your brands.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

    </div>
  );
}
