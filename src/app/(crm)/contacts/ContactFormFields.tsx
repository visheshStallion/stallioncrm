import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CHANNELS } from "@/server/modules/customers/schema";

export interface ContactFormValues {
  accountId?: string | null;
  firstName?: string | null;
  lastName?: string;
  mobile?: string | null;
  altPhone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  city?: string | null;
  address?: string | null;
  preferredChannel?: string | null;
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

/** Contact form. Contact-detail inputs are rendered only when the user's tier lets them see those fields. */
export function ContactFormFields({
  values = {},
  accounts,
  contactTier,
}: {
  values?: ContactFormValues;
  accounts: Array<{ id: string; name: string }>;
  contactTier: boolean;
}) {
  return (
    <div className="space-y-4">
      <FormSection title="Contact Information">
        <F label="First name" id="firstName">
          <Input id="firstName" name="firstName" defaultValue={values.firstName ?? ""} />
        </F>
        <F label="Last name" id="lastName" required>
          <Input id="lastName" name="lastName" defaultValue={values.lastName ?? ""} required />
        </F>
        <F label="Account" id="accountId">
          <Select id="accountId" name="accountId" defaultValue={values.accountId ?? ""} className="w-full">
            <option value="">— none —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="City" id="city">
          <Input id="city" name="city" defaultValue={values.city ?? ""} />
        </F>
      </FormSection>
      {contactTier ? (
        <FormSection title="Contact Details">
          <F label="Mobile" id="mobile">
            <Input id="mobile" name="mobile" defaultValue={values.mobile ?? ""} placeholder="0803 123 4521" />
          </F>
          <F label="Alternative phone" id="altPhone">
            <Input id="altPhone" name="altPhone" defaultValue={values.altPhone ?? ""} />
          </F>
          <F label="Email" id="email">
            <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
          </F>
          <F label="Preferred channel" id="preferredChannel">
            <Select id="preferredChannel" name="preferredChannel" defaultValue={values.preferredChannel ?? ""} className="w-full">
              <option value="">—</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </F>
          <F label="Date of birth" id="dateOfBirth">
            <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={values.dateOfBirth ?? ""} />
          </F>
          <F label="Gender" id="gender">
            <Select id="gender" name="gender" defaultValue={values.gender ?? ""} className="w-full">
              <option value="">—</option>
              <option>Female</option>
              <option>Male</option>
            </Select>
          </F>
          <F label="Address" id="address">
            <Input id="address" name="address" defaultValue={values.address ?? ""} />
          </F>
        </FormSection>
      ) : (
        <p className="rounded-md border border-border bg-surface p-3 text-[13px] text-text-muted">
          Contact details are hidden: you have no records with this customer yet.
        </p>
      )}
    </div>
  );
}
