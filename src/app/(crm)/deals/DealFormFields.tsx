"use client";

import { useState } from "react";
import { CurrencyInput } from "@/components/crm/fields";
import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { DealRow } from "@/server/modules/deals/queries";

interface Lookups {
  brands: Array<{ id: string; code: string; name: string }>;
  regions: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; brandId: string }>;
  accounts: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; name: string; accountId: string | null }>;
  defaultBrandId: string | null;
  defaultRegionId: string | null;
}

function F({ label, id, required, children, hint }: { label: string; id: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label}
        {required ? <Required /> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}
const d = (v?: string | null) => (v ? v.slice(0, 10) : "");

/**
 * Deal form. Brand is chosen at creation (pre-filled for single-brand users) and read-only afterwards; region is
 * editable only by managers; the pipeline follows the brand; the model picker lists the brand's models only.
 */
export function DealFormFields({ lookups, values, mode, canChangeRegion }: { lookups: Lookups; values?: Partial<DealRow>; mode: "create" | "edit"; canChangeRegion: boolean }) {
  const [brandId, setBrandId] = useState(values?.brandId ?? lookups.defaultBrandId ?? "");
  const [accountId, setAccountId] = useState(values?.accountId ?? "");
  const brand = lookups.brands.find((b) => b.id === brandId);
  const products = lookups.products.filter((p) => p.brandId === brandId);
  const contacts = lookups.contacts.filter((c) => !accountId || c.accountId === accountId);
  const v = values ?? {};

  return (
    <div className="space-y-4">
      <FormSection title="Deal Information">
        <F label="Deal name" id="name" required>
          <Input id="name" name="name" defaultValue={v.name ?? ""} required />
        </F>
        <F label="Brand" id="brandId" required hint={mode === "edit" ? "Brand changes go through the Brand Change approval." : undefined}>
          {mode === "edit" ? (
            <Input id="brandId" value={brand ? `${brand.code} – ${brand.name}` : ""} readOnly disabled />
          ) : (
            <Select id="brandId" name="brandId" required value={brandId} onChange={(e) => setBrandId(e.target.value)} className="w-full">
              <option value="">Choose brand…</option>
              {lookups.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </Select>
          )}
        </F>
        <F label="Region" id="regionId" required hint={mode === "edit" && !canChangeRegion ? "Only managers can change the region." : undefined}>
          {mode === "create" || canChangeRegion ? (
            <Select id="regionId" name="regionId" required defaultValue={v.regionId ?? lookups.defaultRegionId ?? ""} className="w-full">
              <option value="">Choose region…</option>
              {lookups.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="regionId" value={lookups.regions.find((r) => r.id === v.regionId)?.name ?? ""} readOnly disabled />
          )}
        </F>
        <F label="Account" id="accountId">
          <Select id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full">
            <option value="">— none —</option>
            {lookups.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Contact" id="contactId">
          <Select id="contactId" name="contactId" defaultValue={v.contactId ?? ""} className="w-full" key={accountId}>
            <option value="">— none —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Customer name (if no account)" id="customerName">
          <Input id="customerName" name="customerName" defaultValue={v.accountId ? "" : v.customerName ?? ""} />
        </F>
        <F label="Amount" id="amount">
          <CurrencyInput id="amount" name="amount" defaultValue={v.amount ?? null} />
        </F>
        <F label="Currency" id="currency">
          <Select id="currency" name="currency" defaultValue={v.currency ?? "NGN"} className="w-full">
            <option value="NGN">NGN – Naira</option>
            <option value="USD">USD – US Dollar</option>
          </Select>
        </F>
        <F label="Expected close date" id="closeDate">
          <Input id="closeDate" name="closeDate" type="date" defaultValue={d(v.closeDate)} />
        </F>
      </FormSection>

      <FormSection title="Vehicle & Payment">
        <F label="Model" id="modelId">
          <Select id="modelId" name="modelId" defaultValue={v.modelId ?? ""} className="w-full" key={brandId} disabled={!brandId}>
            <option value="">{brandId ? "—" : "Choose a brand first"}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Quantity" id="quantity">
          <Input id="quantity" name="quantity" type="number" min={1} defaultValue={v.quantity ?? 1} />
        </F>
        <F label="Colour" id="colour">
          <Input id="colour" name="colour" defaultValue={v.colour ?? ""} />
        </F>
        <F label="Payment type" id="paymentType">
          <Select id="paymentType" name="paymentType" defaultValue={v.paymentType ?? ""} className="w-full">
            <option value="">—</option>
            <option value="CASH">Cash</option>
            <option value="BANK_FINANCE">Bank finance</option>
            <option value="LEASE">Lease</option>
            <option value="FLEET">Fleet</option>
          </Select>
        </F>
        <F label="Finance bank" id="financeBank">
          <Input id="financeBank" name="financeBank" defaultValue={v.financeBank ?? ""} />
        </F>
        <F label="Discount %" id="discountPct">
          <Input id="discountPct" name="discountPct" type="number" min={0} max={100} step="0.01" defaultValue={v.discountPct ?? ""} />
        </F>
        <F label="Trade-in details" id="tradeInDetails">
          <Input id="tradeInDetails" name="tradeInDetails" defaultValue={v.tradeInDetails ?? ""} />
        </F>
      </FormSection>

      {mode === "edit" ? (
        <FormSection title="Booking & Delivery">
          <F label="Test drive date" id="testDriveDate">
            <Input id="testDriveDate" name="testDriveDate" type="date" defaultValue={d(v.testDriveDate)} />
          </F>
          <F label="Deposit amount" id="depositAmount">
            <CurrencyInput id="depositAmount" name="depositAmount" defaultValue={v.depositAmount ?? null} />
          </F>
          <F label="Deposit receipt no." id="depositReceiptNo">
            <Input id="depositReceiptNo" name="depositReceiptNo" defaultValue={v.depositReceiptNo ?? ""} />
          </F>
          <F label="VIN / chassis no." id="vinChassisNo" hint="Unique per brand.">
            <Input id="vinChassisNo" name="vinChassisNo" defaultValue={v.vinChassisNo ?? ""} className="uppercase" />
          </F>
          <F label="Engine no." id="engineNo">
            <Input id="engineNo" name="engineNo" defaultValue={v.engineNo ?? ""} />
          </F>
          <F label="Delivery date" id="deliveryDate">
            <Input id="deliveryDate" name="deliveryDate" type="date" defaultValue={d(v.deliveryDate)} />
          </F>
          <F label="Loss reason" id="lossReason">
            <Input id="lossReason" name="lossReason" defaultValue={v.lossReason ?? ""} />
          </F>
          <F label="Lost to (competitor brand)" id="lossCompetitorBrand">
            <Input id="lossCompetitorBrand" name="lossCompetitorBrand" defaultValue={v.lossCompetitorBrand ?? ""} />
          </F>
        </FormSection>
      ) : null}
    </div>
  );
}
