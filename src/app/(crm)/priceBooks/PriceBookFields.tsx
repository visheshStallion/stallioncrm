"use client";

import { Info, UserSearch } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/crm/form-kit";

export interface PriceBookValues {
  id?: string;
  brandId?: string;
  ownerId?: string | null;
  name?: string;
  active?: boolean;
  pricingModel?: string | null;
  naira?: number | null;
  validFrom?: string;
  validTo?: string | null;
  isDefault?: boolean;
  description?: string | null;
}

const input = "crm-po-input";

/**
 * Create / Edit Price Book (Zoho-style page): Price Book Information (owner, name, active, pricing model, naira) and
 * Description – plus our validity and default flag (one default price book per brand at a time).
 */
export function PriceBookFields({ values = {}, brands, owners, userId, today }: { values?: PriceBookValues; brands: Array<{ id: string; code: string; name: string }>; owners: Array<{ id: string; name: string; brandIds: string[] }>; userId: string; today: string }) {
  const v = values;
  const [brandId, setBrandId] = useState(v.brandId ?? (brands.length === 1 ? brands[0]!.id : ""));
  const brandOwners = owners.filter((o) => !brandId || o.brandIds.includes(brandId));
  return (
    <div className="crm-po-card" data-testid="price-book-form">
      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Price Book Information</h2>
        <div className="crm-po-fields">
          <Field label="Price Book Owner" htmlFor="ownerId">
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
          <Field label="Price Book Name" htmlFor="name">
            <input id="name" name="name" className={`${input} crm-po-req`} defaultValue={v.name ?? ""} required minLength={2} maxLength={80} aria-required />
          </Field>
          <Field label="Active" htmlFor="active">
            <input id="active" name="active" type="checkbox" className="h-4 w-4" defaultChecked={v.active ?? true} />
          </Field>
          <Field label="Pricing Model" htmlFor="pricingModel">
            <select id="pricingModel" name="pricingModel" className={input} defaultValue={v.pricingModel ?? ""}>
              <option value="">-None-</option>
              <option value="FLAT">Flat</option>
              <option value="DIFFERENTIAL">Differential</option>
            </select>
          </Field>
          <Field label="Naira" htmlFor="naira">
            <div className="flex items-center gap-2">
              <div className="crm-po-addon flex-1">
                <span className="crm-po-prefix">₦</span>
                <input id="naira" name="naira" type="number" step="0.01" className={input} defaultValue={v.naira ?? ""} />
              </div>
              <span role="img" aria-label="A naira amount for this price book (for example its flat adjustment) – the prices themselves are the price book's entries" title="A naira amount for this price book (for example its flat adjustment) – the prices themselves are the price book's entries" className="text-text-muted">
                <Info className="h-4 w-4" aria-hidden />
              </span>
            </div>
          </Field>
          <Field label="Brand / Company" htmlFor="brandId">
            {v.id ? (
              <input id="brandId" className={input} value={brands.find((b) => b.id === v.brandId)?.code ?? ""} readOnly disabled />
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
          <Field label="Valid from" htmlFor="validFrom">
            <input id="validFrom" name="validFrom" type="date" className={`${input} crm-po-req`} defaultValue={v.validFrom ?? today} required aria-required />
          </Field>
          <Field label="Valid to" htmlFor="validTo">
            <input id="validTo" name="validTo" type="date" className={input} defaultValue={v.validTo ?? ""} />
          </Field>
          <Field label="Default price book" htmlFor="isDefault">
            <input id="isDefault" name="isDefault" type="checkbox" className="h-4 w-4" defaultChecked={v.isDefault ?? false} title="Only one default price book per brand may be valid at a time" />
          </Field>
        </div>
      </section>
      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Description Information</h2>
        <div className="crm-po-field crm-po-field-wide">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" className={input} defaultValue={v.description ?? ""} maxLength={2000} />
        </div>
      </section>
    </div>
  );
}
