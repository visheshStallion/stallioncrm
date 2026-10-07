"use client";

import { Info, Store, UserSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Field } from "@/components/crm/form-kit";
import type { ProductFormLookups, ProductRow } from "@/server/modules/catalogue/queries";
import { CATEGORIES, CATEGORY_LABELS } from "@/server/modules/catalogue/schema";

const input = "crm-po-input";
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crm-po-section">
      <h2 className="crm-po-section-title">{title}</h2>
      <div className="crm-po-fields">{children}</div>
    </section>
  );
}
const blank = <div className="hidden lg:block" aria-hidden />;

/**
 * Create / Edit Product (Zoho-style page): Product Information, Price Information, Stock Information, Specification
 * and Media (vehicles) and Description. The brand is chosen at creation and never changes; owners, vendors and taxes
 * follow it. The server checks every reference against the brand.
 */
export function ProductFormFields({ values, brands, lookups, userId }: { values?: ProductRow; brands: Array<{ id: string; code: string; name: string }>; lookups: ProductFormLookups; userId: string }) {
  const v = values;
  const [brandId, setBrandId] = useState(v?.brandId ?? (brands.length === 1 ? brands[0]!.id : ""));
  const [taxable, setTaxable] = useState(v?.taxable ?? true);
  const [category, setCategory] = useState(v?.category ?? "VEHICLE");
  const taxes = lookups.taxes[brandId] ?? [{ name: "VAT", rate: 7.5 }];
  const [tax, setTax] = useState(() => (v && v.taxRatePct > 0 ? `${v.taxCode}|${v.taxRatePct}` : `${taxes[0]?.name ?? "VAT"}|${taxes[0]?.rate ?? 7.5}`));
  const [taxCode, taxRate] = tax.split("|");
  const owners = lookups.owners.filter((o) => !brandId || o.brandIds.includes(brandId));
  const vendors = lookups.vendors.filter((x) => x.brandId === brandId);
  const brand = brands.find((b) => b.id === brandId);
  const manufacturer = v?.manufacturer ?? (brandId ? lookups.brandNames[brandId] : "") ?? "";
  const vehicle = category === "VEHICLE";

  return (
    <div className="crm-po-card" data-testid="product-form">
      <input type="hidden" name="taxCode" value={taxable ? taxCode : "NONE"} />
      <input type="hidden" name="taxRatePct" value={taxable ? taxRate : "0"} />
      <Section title="Product Information">
        <Field label="Product Owner" htmlFor="ownerId">
          <div className="crm-po-addon">
            <select id="ownerId" name="ownerId" className={input} defaultValue={v?.ownerId ?? userId}>
              <option value="">-None-</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="crm-po-iconbtn cursor-default" aria-hidden>
              <UserSearch className="h-4 w-4" />
            </span>
          </div>
        </Field>
        <Field label="Product Name" htmlFor="name">
          <input id="name" name="name" className={`${input} crm-po-req`} defaultValue={v?.name ?? ""} maxLength={120} required aria-required />
        </Field>
        <Field label="Product Code" htmlFor="code">
          <input id="code" name="code" className={`${input} crm-po-req uppercase`} defaultValue={v?.code ?? ""} required maxLength={40} placeholder="SKU – letters, digits, - _ ." />
        </Field>
        <Field label="Vendor Name" htmlFor="preferredVendorId">
          <div className="crm-po-addon">
            <select id="preferredVendorId" name="preferredVendorId" className={input} defaultValue={v?.preferredVendorId ?? ""} key={brandId}>
              <option value="">-None-</option>
              {vendors.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <span className="crm-po-iconbtn cursor-default" aria-hidden>
              <Store className="h-4 w-4" />
            </span>
          </div>
        </Field>
        <Field label="Product Active" htmlFor="active">
          <input id="active" type="checkbox" name="active" defaultChecked={v?.active ?? true} className="h-4 w-4" />
        </Field>
        <Field label="Manufacturer" htmlFor="manufacturer">
          <select id="manufacturer" name="manufacturer" className={`${input} crm-po-req`} defaultValue={manufacturer} key={`m${brandId}`} required aria-required>
            <option value="">-None-</option>
            {[...new Set([...lookups.manufacturers, ...(manufacturer ? [manufacturer] : [])])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Product Category" htmlFor="category">
          <select id="category" name="category" className={`${input} crm-po-req`} value={category} onChange={(e) => setCategory(e.target.value)} required aria-required>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Brand / Company" htmlFor="brandId">
          {v ? (
            <input id="brandId" className={input} value={brand ? `${brand.code} – ${brand.name}` : ""} readOnly disabled />
          ) : (
            <select id="brandId" name="brandId" className={`${input} crm-po-req`} value={brandId} onChange={(e) => setBrandId(e.target.value)} required aria-required>
              <option value="">Choose brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Model" htmlFor="model">
          <input id="model" name="model" className={input} defaultValue={v?.model ?? ""} maxLength={80} placeholder="Defaults to the product name" />
        </Field>
        <Field label="Variant / trim" htmlFor="variant">
          <input id="variant" name="variant" className={input} defaultValue={v?.variant ?? ""} maxLength={80} />
        </Field>
      </Section>

      <Section title="Price Information">
        <Field label="Unit Price" htmlFor="listPrice">
          <div className="flex items-center gap-2">
            <div className="crm-po-addon flex-1">
              <span className="crm-po-prefix">₦</span>
              <input id="listPrice" name="listPrice" type="number" min={0} step="0.01" className={input} defaultValue={v?.listPrice ?? ""} />
            </div>
            <span role="img" aria-label="The list price; quotes and orders take the price from the brand's price book" title="The list price; quotes and orders take the price from the brand's price book" className="text-text-muted">
              <Info className="h-4 w-4" aria-hidden />
            </span>
          </div>
        </Field>
        <Field label="Taxable" htmlFor="taxable">
          <input id="taxable" type="checkbox" name="taxable" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="h-4 w-4" />
        </Field>
        <Field label="Tax" htmlFor="tax">
          <select id="tax" className={input} value={taxable ? tax : ""} disabled={!taxable} onChange={(e) => setTax(e.target.value)}>
            {taxable ? null : <option value="">None</option>}
            {[...taxes, ...(v && v.taxRatePct > 0 && !taxes.some((t) => `${t.name}|${t.rate}` === tax) ? [{ name: v.taxCode, rate: v.taxRatePct }] : [])].map((t) => (
              <option key={`${t.name}|${t.rate}`} value={`${t.name}|${t.rate}`}>
                {t.name} – {t.rate} %
              </option>
            ))}
          </select>
        </Field>
        {blank}
      </Section>

      <Section title="Stock Information">
        <Field label="Quantity in Stock" htmlFor="qtyInStock">
          <input id="qtyInStock" name="qtyInStock" type="number" min={0} step="1" className={input} defaultValue={v?.qtyInStock ?? ""} title="For items not tracked in Inventory – vehicles are counted from their VINs" />
        </Field>
        <Field label="Qty Ordered" htmlFor="qtyOrdered">
          <input id="qtyOrdered" name="qtyOrdered" type="number" min={0} step="1" className={input} defaultValue={v?.qtyOrdered ?? ""} />
        </Field>
      </Section>

      {vehicle ? (
        <Section title="Specification">
          <Field label="Model year" htmlFor="modelYear">
            <input id="modelYear" name="modelYear" type="number" className={input} defaultValue={v?.modelYear ?? ""} />
          </Field>
          <Field label="Body type" htmlFor="bodyType">
            <input id="bodyType" name="bodyType" className={input} defaultValue={v?.bodyType ?? ""} />
          </Field>
          <Field label="Fuel" htmlFor="fuel">
            <input id="fuel" name="fuel" className={input} defaultValue={v?.fuel ?? ""} />
          </Field>
          <Field label="Transmission" htmlFor="transmission">
            <input id="transmission" name="transmission" className={input} defaultValue={v?.transmission ?? ""} />
          </Field>
          <Field label="Engine (cc)" htmlFor="engineCc">
            <input id="engineCc" name="engineCc" type="number" className={input} defaultValue={v?.engineCc ?? ""} />
          </Field>
          <Field label="Colours" htmlFor="colours">
            <input id="colours" name="colours" className={input} defaultValue={v?.colours.join(", ") ?? ""} placeholder="comma separated" />
          </Field>
        </Section>
      ) : null}

      <Section title="Media">
        <Field label="Spec sheet URL" htmlFor="specSheetUrl">
          <input id="specSheetUrl" name="specSheetUrl" className={input} defaultValue={v?.specSheetUrl ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Image URLs" htmlFor="imageUrls">
          <textarea id="imageUrls" name="imageUrls" className={input} defaultValue={v?.imageUrls.join("\n") ?? ""} placeholder="one per line" />
        </Field>
      </Section>

      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Description Information</h2>
        <div className="crm-po-field crm-po-field-wide">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" className={`${input} crm-po-req`} defaultValue={v?.description ?? ""} maxLength={2000} required aria-required />
        </div>
      </section>
    </div>
  );
}
