import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { RecordHeader, RelatedListCard } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { canManageBrandData } from "@/server/access/brand-tag";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { removeEntryAction, updatePriceBookAction, upsertEntryAction } from "@/server/modules/catalogue/actions";
import { getPriceBook, listProducts } from "@/server/modules/catalogue/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { PriceImport } from "./PriceImport";

export default async function PriceBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "priceBooks", "read")) forbidden();
  // Price books of brands the user does not work in are 404.
  const book = await getPriceBook(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, products] = await Promise.all([getDirectory(ctx), listProducts(ctx, { brandId: book.brandId, take: 2000 })]);
  const brand = dir.brands.find((b) => b.id === book.brandId);
  const canEdit = canManageBrandData(ctx, "priceBooks", "edit", book.brandId);
  const missing = products.rows.filter((p) => !book.entries.some((e) => e.productId === p.id));

  return (
    <div>
      <RecordHeader
        backHref="/priceBooks"
        brand={brand}
        moduleLabel="Price Book"
        title={book.name}
        meta={
          <>
            {book.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
            <StatusPill tone={book.validToday ? "success" : "neutral"}>{!book.active ? "Inactive" : book.validToday ? "Valid today" : "Not valid today"}</StatusPill>
          </>
        }
        actions={
          can(ctx, "priceBooks", "export") ? (
            <Button asChild variant="outline">
              <a href={`/api/v1/priceBooks/${book.id}/export`}>Export CSV</a>
            </Button>
          ) : null
        }
      />
      <div className="space-y-3">
        {canEdit ? (
          <section className="rounded-lg border border-border bg-surface p-4">
            <ActionForm action={updatePriceBookAction} className="flex flex-wrap items-end gap-2 text-[13px]">
              <input type="hidden" name="id" value={book.id} />
              <Input name="name" defaultValue={book.name} required className="w-64" aria-label="Name" />
              <label>
                Valid from <Input name="validFrom" type="date" required defaultValue={book.validFrom} className="w-40" />
              </label>
              <label>
                Valid to <Input name="validTo" type="date" defaultValue={book.validTo ?? ""} className="w-40" />
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="active" defaultChecked={book.active} /> active
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="isDefault" defaultChecked={book.isDefault} /> default
              </label>
              <SubmitButton size="sm" variant="outline">
                Save
              </SubmitButton>
            </ActionForm>
          </section>
        ) : null}

        <RelatedListCard id="entries" title="Prices" count={book.entries.length}>
          <table className="w-full text-[13px]" data-testid="price-entries">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="py-1">Code</th>
                <th>Product</th>
                <th className="text-right">List price</th>
                <th>Price · max discount % · notes</th>
              </tr>
            </thead>
            <tbody>
              {book.entries.map((e) => (
                <tr key={`${e.id}:${e.price}:${e.maxDiscountPct}:${e.notes}`} className="border-t border-border">
                  <td className="py-1.5 font-mono">{e.code}</td>
                  <td>
                    <Link href={`/products/${e.productId}`} className="text-primary hover:underline">
                      {e.productName}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(e.listPrice)}</td>
                  <td>
                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <ActionForm action={upsertEntryAction} className="flex items-center gap-1">
                          <input type="hidden" name="priceBookId" value={book.id} />
                          <input type="hidden" name="productId" value={e.productId} />
                          <Input name="price" type="number" min={0} step="0.01" defaultValue={e.price} className="h-8 w-36 text-right" aria-label={`Price for ${e.code}`} />
                          <Input name="maxDiscountPct" type="number" min={0} max={100} step="0.01" defaultValue={e.maxDiscountPct ?? ""} className="h-8 w-20" aria-label="Max discount %" />
                          <Input name="notes" defaultValue={e.notes ?? ""} className="h-8 w-40" aria-label="Notes" />
                          <SubmitButton size="sm" variant="outline">
                            Save
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={removeEntryAction} confirm={`Remove ${e.code} from this price book?`}>
                          <input type="hidden" name="priceBookId" value={book.id} />
                          <input type="hidden" name="entryId" value={e.id} />
                          <Button size="sm" variant="ghost" type="submit">
                            Remove
                          </Button>
                        </ActionForm>
                      </div>
                    ) : (
                      <span className="tabular-nums">
                        {formatMoney(e.price)}
                        {e.maxDiscountPct !== null ? ` · max ${e.maxDiscountPct}%` : ""}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && missing.length ? (
            <ActionForm action={upsertEntryAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <input type="hidden" name="priceBookId" value={book.id} />
              <Select name="productId" required aria-label="Product to add" className="w-64">
                <option value="">Add product…</option>
                {missing.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} – {p.name}
                  </option>
                ))}
              </Select>
              <Input name="price" type="number" min={0} step="0.01" placeholder="Price" required className="w-36" aria-label="Price" />
              <Input name="maxDiscountPct" type="number" min={0} max={100} step="0.01" placeholder="Max disc. %" className="w-28" aria-label="Max discount %" />
              <SubmitButton size="sm">Add</SubmitButton>
            </ActionForm>
          ) : null}
        </RelatedListCard>

        {canEdit ? (
          <RelatedListCard id="import" title="Import prices from CSV">
            <PriceImport priceBookId={book.id} />
          </RelatedListCard>
        ) : null}
      </div>
    </div>
  );
}
