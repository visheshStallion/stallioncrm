import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { canManageBrandData } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { addStockAction } from "@/server/modules/catalogue/actions";
import { getPrice, getProduct, listStock } from "@/server/modules/catalogue/queries";
import { STATUS_LABELS, type VehicleStatus } from "@/server/modules/inventory/status";
import { CATEGORY_LABELS, STOCK_LABELS, STOCK_STATUSES } from "@/server/modules/catalogue/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { scopedDb } from "@/server/db";
import { requireContext } from "@/server/request";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "products", "read")) forbidden();
  // Products of brands the user does not work in are 404.
  const product = await getProduct(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, price, stock] = await Promise.all([getDirectory(ctx), getPrice(ctx, id), listStock(ctx, { productId: id })]);
  const brand = dir.brands.find((b) => b.id === product.brandId);
  const [owner, vendor] = await Promise.all([
    product.ownerId ? scopedDb(ctx).user.findUnique({ where: { id: product.ownerId }, select: { name: true } }) : null,
    product.preferredVendorId ? scopedDb(ctx).vendor.findUnique({ where: { id: product.preferredVendorId }, select: { name: true } }) : null,
  ]);
  const canEdit = canManageBrandData(ctx, "products", "edit", product.brandId);

  return (
    <div>
      <RecordHeader
        backHref="/products"
        brand={brand}
        moduleLabel="Product"
        title={product.name}
        meta={
          <>
            <StatusPill>{CATEGORY_LABELS[product.category as keyof typeof CATEGORY_LABELS]}</StatusPill>
            {!product.active ? <StatusPill tone="warning">Inactive</StatusPill> : null}
          </>
        }
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={`/products/${product.id}/edit`} data-shortcut="edit">
                Edit
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="space-y-3">
        {product.imageUrls.length ? (
          <div className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-surface p-3">
            {product.imageUrls.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element -- catalogue images are external URLs
              <img key={u} src={u} alt={product.name} className="h-40 rounded object-cover" />
            ))}
          </div>
        ) : null}
        <FieldSection title="Product Information">
          <Field label="Product Owner" value={owner?.name ?? null} />
          <Field label="Code / SKU" value={product.code} />
          <Field label="Manufacturer" value={product.manufacturer} />
          <Field label="Vendor Name" value={vendor?.name ?? null} />
          <Field label="Product Active" value={product.active ? "Yes" : "No"} />
          <Field label="Quantity in Stock" value={product.qtyInStock} />
          <Field label="Qty Ordered" value={product.qtyOrdered} />
          <Field label="Model" value={product.model} />
          <Field label="Variant" value={product.variant} />
          <Field label="Model year" value={product.modelYear} />
          <Field label="Body type" value={product.bodyType} />
          <Field label="Fuel" value={product.fuel} />
          <Field label="Transmission" value={product.transmission} />
          <Field label="Engine" value={product.engineCc ? `${product.engineCc} cc` : null} />
          <Field label="Colours" value={product.colours.join(", ")} />
          <Field
            label="Spec sheet"
            value={
              product.specSheetUrl ? (
                <a href={product.specSheetUrl} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                  Open
                </a>
              ) : null
            }
          />
          <Field label="Description" value={product.description} />
        </FieldSection>
        <FieldSection title="Price">
          <Field label="List price" value={formatMoney(product.listPrice)} />
          <Field label="Current price" value={<span data-testid="current-price">{formatMoney(price.price)}</span>} />
          <Field label="Price source" value={price.source === "priceBook" ? "Default price book" : price.source === "listPrice" ? "List price (no valid price book entry)" : "—"} />
          <Field label="Taxable" value={product.taxable ? "Yes" : "No"} />
          <Field label="Tax" value={product.taxable ? `${product.taxCode} ${product.taxRatePct}%` : "None"} />
          <Field label="Price incl. tax" value={formatMoney(price.gross)} />
          <Field label="Max discount" value={price.maxDiscountPct === null ? null : `${price.maxDiscountPct}%`} />
        </FieldSection>
        {product.category === "VEHICLE" ? (
          <RelatedListCard id="stock" title="Vehicle stock (VIN references)" count={stock.length}>
            <div className="space-y-3">
              <table className="w-full text-[13px]" data-testid="stock-table">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">VIN</th>
                    <th>Colour</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="py-1.5 font-mono">{s.vin}</td>
                      <td>{s.colour ?? "—"}</td>
                      <td>{s.location ?? "—"}</td>
                      <td>
                        <StatusPill tone={s.status === "AVAILABLE" ? "success" : s.status === "RESERVED" || s.status === "ALLOCATED" ? "warning" : "neutral"}>{STATUS_LABELS[s.status as VehicleStatus] ?? s.status}</StatusPill>
                      </td>
                      <td>{s.dealId ? <Link href={`/deals/${s.dealId}`} className="text-primary underline">open</Link> : "—"}</td>
                    </tr>
                  ))}
                  {stock.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-2 text-text-muted">
                        No stock references.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {canEdit ? (
                <ActionForm action={addStockAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <input type="hidden" name="productId" value={product.id} />
                  <Input name="vin" placeholder="VIN / chassis no." required className="w-56 uppercase" aria-label="VIN" />
                  <Input name="colour" placeholder="Colour" className="w-32" aria-label="Colour" />
                  <Input name="location" placeholder="Location" className="w-40" aria-label="Location" />
                  <Select name="status" defaultValue="IN_STOCK" aria-label="Status">
                    {STOCK_STATUSES.filter((s) => s === "IN_STOCK" || s === "IN_TRANSIT").map((s) => (
                      <option key={s} value={s}>
                        {STOCK_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm">Add vehicle</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </RelatedListCard>
        ) : null}
      </div>
    </div>
  );
}
