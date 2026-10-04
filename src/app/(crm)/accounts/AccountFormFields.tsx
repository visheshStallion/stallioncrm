"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CurrencyInput } from "@/components/crm/fields";
import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { checkAccountMatchesAction } from "@/server/modules/customers/actions";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, KYC_LABELS, KYC_STATUSES } from "@/server/modules/customers/schema";

export interface AccountFormValues {
  id?: string;
  name?: string;
  type?: string;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  rcNumber?: string | null;
  creditLimit?: number | null;
  kycStatus?: string | null;
}

function F({ label, id, required, children }: { label: string; id: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label}
        {required ? <Required /> : null}
      </Label>
      {children}
    </div>
  );
}

type Match = { id: string; name: string; city: string | null; phone: string | null; reasons: string[] };

/**
 * Account form. `contactTier` / `sensitiveTier` say which field groups the user may edit: groups above the
 * user's tier are not rendered as inputs at all (so masked values can never be saved back).
 */
export function AccountFormFields({ values = {}, contactTier, sensitiveTier }: { values?: AccountFormValues; contactTier: boolean; sensitiveTier: boolean }) {
  const [name, setName] = useState(values.name ?? "");
  const [city, setCity] = useState(values.city ?? "");
  const [phone, setPhone] = useState(values.phone ?? "");
  const [email, setEmail] = useState(values.email ?? "");
  const [rc, setRc] = useState(values.rcNumber ?? "");
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (name.trim().length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await checkAccountMatchesAction({ name, city, phone: contactTier ? phone : "", email: contactTier ? email : "", rcNumber: rc, excludeId: values.id });
      setMatches(res.ok ? res.data : []);
    }, 400);
    return () => clearTimeout(t);
  }, [name, city, phone, email, rc, values.id, contactTier]);

  return (
    <div className="space-y-4">
      <FormSection title="Account Information">
        <F label="Account name" id="name" required>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </F>
        <F label="Type" id="type">
          <Select id="type" name="type" defaultValue={values.type ?? "INDIVIDUAL"} className="w-full">
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </F>
        <F label="Industry" id="industry">
          <Input id="industry" name="industry" defaultValue={values.industry ?? ""} />
        </F>
        <F label="City" id="city">
          <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </F>
      </FormSection>

      {matches.length ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px]" role="status" data-testid="account-matches">
          <p className="font-semibold">This customer may already exist – open it instead of creating a duplicate:</p>
          <ul className="mt-1 space-y-0.5">
            {matches.map((m) => (
              <li key={m.id}>
                <Link href={`/accounts/${m.id}`} target="_blank" className="text-primary underline">
                  {m.name}
                </Link>{" "}
                <span className="text-text-muted">
                  {[m.city, m.phone].filter(Boolean).join(" · ")} — same {m.reasons.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {contactTier ? (
        <FormSection title="Contact Details">
          <F label="Phone" id="phone">
            <Input id="phone" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4521" />
          </F>
          <F label="Email" id="email">
            <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </F>
          <F label="Address" id="address">
            <Input id="address" name="address" defaultValue={values.address ?? ""} />
          </F>
          <F label="State" id="state">
            <Input id="state" name="state" defaultValue={values.state ?? ""} />
          </F>
          <F label="Website" id="website">
            <Input id="website" name="website" defaultValue={values.website ?? ""} />
          </F>
          <F label="Notes" id="notes">
            <Input id="notes" name="notes" defaultValue={values.notes ?? ""} />
          </F>
        </FormSection>
      ) : (
        <p className="rounded-md border border-border bg-surface p-3 text-[13px] text-text-muted">
          Contact details are hidden: you have no records with this customer yet.
        </p>
      )}

      {sensitiveTier ? (
        <FormSection title="Company & Credit (sensitive)">
          <F label="RC number" id="rcNumber">
            <Input id="rcNumber" name="rcNumber" value={rc} onChange={(e) => setRc(e.target.value)} />
          </F>
          <F label="Credit limit" id="creditLimit">
            <CurrencyInput id="creditLimit" name="creditLimit" defaultValue={values.creditLimit ?? null} />
          </F>
          <F label="KYC status" id="kycStatus">
            <Select id="kycStatus" name="kycStatus" defaultValue={values.kycStatus ?? "NOT_STARTED"} className="w-full">
              {KYC_STATUSES.map((k) => (
                <option key={k} value={k}>
                  {KYC_LABELS[k]}
                </option>
              ))}
            </Select>
          </F>
        </FormSection>
      ) : null}
    </div>
  );
}
