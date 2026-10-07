"use client";

import { ImageIcon, UserSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Field } from "@/components/crm/form-kit";
import { COUNTRIES } from "@/lib/countries";

const VENDOR_TYPES: Record<string, string> = { OEM: "OEM / manufacturer", DISTRIBUTOR: "Distributor", CLEARING_AGENT: "Clearing agent", SHIPPING_LINE: "Shipping line", TRANSPORTER: "Transporter", PARTS_SUPPLIER: "Parts supplier" };
const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"];

export interface VendorValues {
  id?: string;
  brandId?: string;
  ownerId?: string | null;
  name?: string;
  type?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  glAccount?: string | null;
  category?: string | null;
  emailOptOut?: boolean;
  contactName?: string | null;
  currency?: string;
  paymentTerms?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  description?: string | null;
  taxId?: string | null;
  bankDetails?: string | null;
  active?: boolean;
  hasImage?: boolean;
}

const input = "crm-po-input";
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crm-po-section">
      <h2 className="crm-po-section-title">{title}</h2>
      <div className="crm-po-fields">{children}</div>
    </section>
  );
}

/**
 * Create / Edit Vendor (Zoho-style page): Vendor Image, Vendor Information, Address Information, Description – plus
 * our purchasing fields (brand, type, contact person, currency, payment terms; tax id and bank details for finance).
 */
export function VendorFields({ values = {}, brands, owners, glAccounts, finance, userId }: { values?: VendorValues; brands: Array<{ id: string; code: string; name: string }>; owners: Array<{ id: string; name: string; brandIds: string[] }>; glAccounts: readonly string[]; finance: boolean; userId: string }) {
  const v = values;
  const [brandId, setBrandId] = useState(v.brandId ?? (brands.length === 1 ? brands[0]!.id : ""));
  const [preview, setPreview] = useState<string | null>(v.id && v.hasImage ? `/api/v1/vendors/${v.id}/image` : null);
  const brandOwners = owners.filter((o) => !brandId || o.brandIds.includes(brandId));
  return (
    <div className="crm-po-card" data-testid="vendor-form">
      <datalist id="vendor-countries">
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Vendor Image</h2>
        <label className="inline-flex cursor-pointer items-center gap-3 text-[13px] text-text-muted">
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-alt">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview or the vendor's own image route
              <img src={preview} alt="Vendor image" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-6 w-6" aria-hidden />
            )}
          </span>
          <span>PNG, JPEG or WebP, up to 512 KB</span>
          <input
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Vendor image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPreview(URL.createObjectURL(f));
            }}
          />
        </label>
      </section>

      <Section title="Vendor Information">
        <Field label="Vendor Owner" htmlFor="ownerId">
          <div className="crm-po-addon">
            <select id="ownerId" name="ownerId" className={input} defaultValue={v.ownerId ?? userId} key={brandId}>
              {brandOwners.map((o) => (
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
        <Field label="Vendor Name" htmlFor="name">
          <input id="name" name="name" className={`${input} crm-po-req`} defaultValue={v.name ?? ""} required minLength={2} maxLength={120} aria-required />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <input id="phone" name="phone" type="tel" className={input} defaultValue={v.phone ?? ""} maxLength={40} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" className={input} defaultValue={v.email ?? ""} maxLength={200} />
        </Field>
        <Field label="Website" htmlFor="website">
          <input id="website" name="website" className={input} defaultValue={v.website ?? ""} maxLength={200} placeholder="www.example.com" />
        </Field>
        <Field label="GL Account" htmlFor="glAccount">
          <select id="glAccount" name="glAccount" className={input} defaultValue={v.glAccount ?? glAccounts[0]}>
            <option value="">-None-</option>
            {glAccounts.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="category">
          <input id="category" name="category" className={input} defaultValue={v.category ?? ""} maxLength={80} />
        </Field>
        <Field label="Email Opt Out" htmlFor="emailOptOut">
          <input id="emailOptOut" name="emailOptOut" type="checkbox" className="h-4 w-4" defaultChecked={v.emailOptOut ?? false} />
        </Field>
      </Section>

      <Section title="Purchasing">
        <Field label="Brand / Company" htmlFor="brandId">
          {v.id ? (
            <>
              <input type="hidden" name="brandId" value={v.brandId} />
              <input id="brandId" className={input} value={brands.find((b) => b.id === v.brandId)?.code ?? ""} readOnly disabled />
            </>
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
        <Field label="Vendor type" htmlFor="type">
          <select id="type" name="type" className={input} defaultValue={v.type ?? "OEM"}>
            {Object.entries(VENDOR_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contact person" htmlFor="contactName">
          <input id="contactName" name="contactName" className={input} defaultValue={v.contactName ?? ""} maxLength={100} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <select id="currency" name="currency" className={input} defaultValue={v.currency ?? "NGN"}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Payment terms" htmlFor="paymentTerms">
          <input id="paymentTerms" name="paymentTerms" className={input} defaultValue={v.paymentTerms ?? ""} maxLength={120} />
        </Field>
        {v.id ? (
          <Field label="Active" htmlFor="active">
            <input id="active" name="active" type="checkbox" className="h-4 w-4" defaultChecked={v.active ?? true} />
          </Field>
        ) : (
          <div className="hidden lg:block" aria-hidden />
        )}
        {finance ? (
          <>
            <Field label="Tax ID (TIN)" htmlFor="taxId">
              <input id="taxId" name="taxId" className={input} defaultValue={v.taxId ?? ""} maxLength={60} />
            </Field>
            <Field label="Bank details" htmlFor="bankDetails">
              <input id="bankDetails" name="bankDetails" className={input} defaultValue={v.bankDetails ?? ""} maxLength={500} />
            </Field>
          </>
        ) : null}
      </Section>

      <Section title="Address Information">
        <Field label="Street" htmlFor="address">
          <input id="address" name="address" className={input} defaultValue={v.address ?? ""} maxLength={300} />
        </Field>
        <Field label="City" htmlFor="city">
          <input id="city" name="city" className={input} defaultValue={v.city ?? ""} maxLength={80} />
        </Field>
        <Field label="State" htmlFor="state">
          <input id="state" name="state" className={input} defaultValue={v.state ?? ""} maxLength={80} />
        </Field>
        <Field label="Zip Code" htmlFor="zipCode">
          <input id="zipCode" name="zipCode" className={input} defaultValue={v.zipCode ?? ""} maxLength={20} />
        </Field>
        <Field label="Country" htmlFor="country">
          <input id="country" name="country" list="vendor-countries" className={input} defaultValue={v.country ?? "Nigeria"} maxLength={80} />
        </Field>
      </Section>

      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Description Information</h2>
        <div className="crm-po-field crm-po-field-wide">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" className={input} defaultValue={v.description ?? ""} maxLength={4000} />
        </div>
      </section>
    </div>
  );
}
