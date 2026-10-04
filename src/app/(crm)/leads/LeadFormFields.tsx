"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { checkDuplicatesAction } from "@/server/modules/leads/actions";
import type { DuplicateReport } from "@/server/modules/leads/duplicates";
import {
  LEAD_SOURCES,
  PAYMENT_INTENTS,
  PAYMENT_LABELS,
  PURCHASE_WINDOWS,
  RATINGS,
  SETTABLE_STATUSES,
  SOURCE_LABELS,
  STATUS_LABELS,
  WINDOW_LABELS,
} from "@/server/modules/leads/schema";

export interface LeadFormLookups {
  brands: Array<{ id: string; code: string; name: string }>;
  regions: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; brandId: string }>;
  users: Array<{ id: string; name: string }>;
  defaultBrandId: string | null;
  defaultRegionId: string | null;
}

export interface LeadFormValues {
  id?: string;
  firstName?: string | null;
  lastName?: string;
  mobile?: string | null;
  email?: string | null;
  city?: string | null;
  source?: string;
  sourceDetail?: string | null;
  modelOfInterestId?: string | null;
  budget?: number | null;
  paymentIntent?: string | null;
  tradeIn?: boolean;
  tradeInNotes?: string | null;
  expectedPurchaseWindow?: string | null;
  rating?: string | null;
  consentMarketing?: boolean;
  brandId?: string;
  regionId?: string;
  status?: string;
  unqualifiedReason?: string | null;
}

function Field({ label, htmlFor, children, required }: { label: string; htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1" data-field={htmlFor}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <Required /> : null}
      </Label>
      {children}
    </div>
  );
}

/**
 * Lead form fields. Brand is required; auto-filled when the user has one brand; read-only after create.
 * The model picker only shows the selected brand's products. Duplicate check runs on mobile/email.
 */
export function LeadFormFields({
  lookups,
  values = {},
  mode,
}: {
  lookups: LeadFormLookups;
  values?: LeadFormValues;
  mode: "create" | "edit";
}) {
  const [brandId, setBrandId] = useState(values.brandId ?? lookups.defaultBrandId ?? "");
  const [mobile, setMobile] = useState(values.mobile ?? "");
  const [email, setEmail] = useState(values.email ?? "");
  const [status, setStatus] = useState(values.status ?? "NEW");
  const [dupes, setDupes] = useState<DuplicateReport | null>(null);
  const products = lookups.products.filter((p) => p.brandId === brandId);
  const brand = lookups.brands.find((b) => b.id === brandId);

  useEffect(() => {
    if (!brandId || (!mobile.trim() && !email.trim())) {
      setDupes(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await checkDuplicatesAction({ brandId, mobile, email, excludeId: values.id });
      setDupes(res.ok ? res.data : null);
    }, 400);
    return () => clearTimeout(t);
  }, [brandId, mobile, email, values.id]);

  return (
    <div className="space-y-4">
      <FormSection title="Lead Information">
        <Field label="Brand" htmlFor="brandId" required>
          {mode === "edit" ? (
            <>
              <Input id="brandId" value={brand ? `${brand.code} – ${brand.name}` : ""} readOnly disabled />
              <input type="hidden" name="brandId" value={brandId} />
            </>
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
        </Field>
        <Field label="Region" htmlFor="regionId" required>
          <Select id="regionId" name="regionId" required defaultValue={values.regionId ?? lookups.defaultRegionId ?? ""} className="w-full">
            <option value="">Choose region…</option>
            {lookups.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model of interest" htmlFor="modelOfInterestId">
          <Select id="modelOfInterestId" name="modelOfInterestId" defaultValue={values.modelOfInterestId ?? ""} className="w-full" key={brandId}>
            <option value="">—</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="First name" htmlFor="firstName">
          <Input id="firstName" name="firstName" defaultValue={values.firstName ?? ""} />
        </Field>
        <Field label="Last name" htmlFor="lastName" required>
          <Input id="lastName" name="lastName" defaultValue={values.lastName ?? ""} required />
        </Field>
        <Field label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={values.city ?? ""} />
        </Field>
        <Field label="Mobile (or email)" htmlFor="mobile" required>
          <Input id="mobile" name="mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="0803 123 4521" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Rating" htmlFor="rating">
          <Select id="rating" name="rating" defaultValue={values.rating ?? ""} className="w-full">
            <option value="">—</option>
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      {dupes && (dupes.sameBrand.length || dupes.existsElsewhere || dupes.contacts.length) ? (
        <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="duplicate-warning" role="status">
          {dupes.sameBrand.length ? (
            <p>
              Possible duplicate in this brand:{" "}
              {dupes.sameBrand.map((d, i) => (
                <span key={d.id}>
                  {i ? ", " : ""}
                  <Link href={`/leads/${d.id}`} className="underline" target="_blank">
                    {d.name}
                  </Link>{" "}
                  ({d.status.toLowerCase()}, {d.ownerName})
                </span>
              ))}
            </p>
          ) : null}
          {dupes.existsElsewhere || dupes.contacts.length ? (
            <p>Customer exists – link instead when converting{dupes.contacts.length ? ` (${dupes.contacts.map((c) => c.name).join(", ")})` : ""}.</p>
          ) : null}
        </div>
      ) : null}

      <FormSection title="Source, Vehicle & Payment">
        <Field label="Source" htmlFor="source">
          <Select id="source" name="source" defaultValue={values.source ?? "WALK_IN"} className="w-full">
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source detail" htmlFor="sourceDetail">
          <Input id="sourceDetail" name="sourceDetail" defaultValue={values.sourceDetail ?? ""} />
        </Field>
        <Field label="Budget (₦)" htmlFor="budget">
          <Input id="budget" name="budget" type="number" min={0} step="1000" defaultValue={values.budget ?? ""} />
        </Field>
        <Field label="Payment intent" htmlFor="paymentIntent">
          <Select id="paymentIntent" name="paymentIntent" defaultValue={values.paymentIntent ?? ""} className="w-full">
            <option value="">—</option>
            {PAYMENT_INTENTS.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expected purchase" htmlFor="expectedPurchaseWindow">
          <Select id="expectedPurchaseWindow" name="expectedPurchaseWindow" defaultValue={values.expectedPurchaseWindow ?? ""} className="w-full">
            <option value="">—</option>
            {PURCHASE_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABELS[w]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full">
            {SETTABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {status === "UNQUALIFIED" ? (
          <Field label="Unqualified reason" htmlFor="unqualifiedReason">
            <Input id="unqualifiedReason" name="unqualifiedReason" defaultValue={values.unqualifiedReason ?? ""} required />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center gap-4 pt-6 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="tradeIn" defaultChecked={values.tradeIn} /> Trade-in
          </label>
          <Input name="tradeInNotes" placeholder="Trade-in notes" defaultValue={values.tradeInNotes ?? ""} className="max-w-xs" aria-label="Trade-in notes" />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="consentMarketing" defaultChecked={values.consentMarketing} /> Marketing consent
          </label>
        </div>
      </FormSection>

      {mode === "create" ? (
        <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted/60 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="autoAssign" /> Assign automatically (assignment rules)
          </label>
          <span className="text-muted-foreground">or owner:</span>
          <Select name="ownerId" defaultValue="" aria-label="Owner" className="w-56">
            <option value="">Me</option>
            {lookups.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}
