import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { canManageBrandData } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { createPriceBookAction } from "@/server/modules/catalogue/actions";
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
      <PageTitleRow title="Price Books" left={<span className="text-[13px] text-text-muted">{books.length} price book(s) of your brands</span>} />
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

      {manageable.length ? (
        <section className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-[13px] font-semibold">New price book</h2>
          <ActionForm action={createPriceBookAction} className="flex flex-wrap items-end gap-2 text-[13px]">
            <Select name="brandId" required defaultValue={manageable.length === 1 ? manageable[0]!.id : ""} aria-label="Brand">
              <option value="">Brand…</option>
              {manageable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
            <Input name="name" placeholder="Name" required className="w-56" aria-label="Name" />
            <label>
              Valid from <Input name="validFrom" type="date" required className="w-40" />
            </label>
            <label>
              Valid to <Input name="validTo" type="date" className="w-40" />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="active" defaultChecked /> active
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="isDefault" /> default
            </label>
            <SubmitButton size="sm">Create</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-text-muted">Only one default price book per brand may be valid at a time – overlapping default books are rejected.</p>
        </section>
      ) : null}
    </div>
  );
}
