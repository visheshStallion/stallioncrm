import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { Field, FieldSection } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { getVendor } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Vendor" };

/** Vendor record: image, Vendor Information, purchasing, address, description and its purchase orders. */
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const v = await getVendor(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, orders] = await Promise.all([getDirectory(ctx), scopedDb(ctx).inventoryDocument.findMany({ where: { vendorId: id, type: "PO" }, select: { id: true, number: true, subject: true, status: true }, orderBy: { createdAt: "desc" }, take: 20 })]);
  const brand = dir.brands.find((b) => b.id === v.brandId);
  return (
    <div className="space-y-3" data-testid="vendor-record">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3" data-testid="record-header">
        <Link href="/vendors" className="text-sm text-primary hover:underline">
          ← Vendors
        </Link>
        {v.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- the vendor image route
          <img src={`/api/v1/vendors/${v.id}/image`} alt="" className="h-10 w-10 rounded-full border border-border object-cover" />
        ) : null}
        {brand ? <BrandBadge brand={brand} /> : null}
        <h1 className="text-lg font-semibold">{v.name}</h1>
        {v.active ? null : <span className="text-xs text-text-muted">inactive</span>}
        <div className="ml-auto flex gap-2">
          {hasPermission(ctx, "inventory", "edit") ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/vendors/${v.id}/edit`} data-testid="vendor-edit">
                Edit
              </Link>
            </Button>
          ) : null}
          {hasPermission(ctx, "inventory", "create") ? (
            <Button asChild size="sm">
              <Link href={`/purchaseOrders/new?brand=${v.brandId}&vendor=${v.id}`}>Create Purchase Order</Link>
            </Button>
          ) : null}
        </div>
      </header>
      <FieldSection title="Vendor Information">
        <Field label="Vendor Owner" value={v.ownerName ?? "—"} />
        <Field label="Vendor Name" value={v.name} />
        <Field label="Phone" value={v.phone ?? "—"} />
        <Field label="Email" value={v.email ?? "—"} />
        <Field
          label="Website"
          value={
            v.website ? (
              <a href={v.website} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                {v.website}
              </a>
            ) : (
              "—"
            )
          }
        />
        <Field label="GL Account" value={v.glAccount ?? "—"} />
        <Field label="Category" value={v.category ?? "—"} />
        <Field label="Email Opt Out" value={v.emailOptOut ? "Yes" : "No"} />
      </FieldSection>
      <FieldSection title="Purchasing">
        <Field label="Vendor type" value={v.type} />
        <Field label="Contact person" value={v.contactName ?? "—"} />
        <Field label="Currency" value={v.currency} />
        <Field label="Payment terms" value={v.paymentTerms ?? "—"} />
        {v.taxId !== null ? <Field label="Tax ID (TIN)" value={v.taxId || "—"} /> : null}
        {v.bankDetails !== null ? <Field label="Bank details" value={v.bankDetails || "—"} /> : null}
      </FieldSection>
      <FieldSection title="Address Information">
        <Field label="Street" value={v.address ?? "—"} />
        <Field label="City" value={v.city ?? "—"} />
        <Field label="State" value={v.state ?? "—"} />
        <Field label="Zip Code" value={v.zipCode ?? "—"} />
        <Field label="Country" value={v.country ?? "—"} />
      </FieldSection>
      <FieldSection title="Description Information">
        <Field label="Description" value={<span className="whitespace-pre-wrap">{v.description || "—"}</span>} />
      </FieldSection>
      <FieldSection title="Purchase Orders">
        {orders.length ? (
          orders.map((o) => (
            <Field
              key={o.id}
              label={o.number}
              value={
                <Link href={`/purchaseOrders/${o.id}`} className="text-primary hover:underline">
                  {`${o.subject ?? ""} · ${o.status.toLowerCase().replace(/_/g, " ")}`}
                </Link>
              }
            />
          ))
        ) : (
          <Field label="—" value="No purchase orders yet" />
        )}
      </FieldSection>
    </div>
  );
}
