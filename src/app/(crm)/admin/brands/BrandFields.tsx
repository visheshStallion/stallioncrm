import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface BrandFormValues {
  code?: string;
  name?: string;
  legalEntity?: string | null;
  erpCompanyCode?: string | null;
  docPrefix?: string | null;
  color?: string | null;
  logoUrl?: string | null;
  status?: string;
  brandManagerId?: string | null;
  address?: string | null;
  bankDetails?: string | null;
  documentTerms?: string | null;
  discountApprovalPct?: unknown;
  discountEscalationPct?: unknown;
  fromName?: string | null;
  fromEmail?: string | null;
  smsSenderId?: string | null;
  smsInboundNumber?: string | null;
  whatsappNumber?: string | null;
  whatsappPhoneId?: string | null;
}

/** Shared brand form fields (create + edit). */
export function BrandFields({
  values = {},
  users,
  codeLocked = false,
}: {
  values?: BrandFormValues;
  users: Array<{ id: string; name: string }>;
  codeLocked?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="code">Code</Label>
        <Input id="code" name="code" defaultValue={values.code} required readOnly={codeLocked} className="uppercase" />
        {codeLocked ? <p className="text-xs text-muted-foreground">Immutable – the brand is in use</p> : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={values.name} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="status">Status</Label>
        <Select id="status" name="status" defaultValue={values.status ?? "ACTIVE"} className="w-full">
          <option value="ACTIVE">Active</option>
          <option value="FUTURE">Future</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="legalEntity">Legal entity</Label>
        <Input id="legalEntity" name="legalEntity" defaultValue={values.legalEntity ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="erpCompanyCode">ERP company code</Label>
        <Input id="erpCompanyCode" name="erpCompanyCode" defaultValue={values.erpCompanyCode ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="docPrefix">Document prefix</Label>
        <Input id="docPrefix" name="docPrefix" defaultValue={values.docPrefix ?? ""} placeholder="e.g. HMNL" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="color">Brand colour</Label>
        <Input id="color" name="color" type="color" defaultValue={values.color ?? "#1d4ed8"} className="h-9 p-1" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="brandManagerId">Brand Manager</Label>
        <Select id="brandManagerId" name="brandManagerId" defaultValue={values.brandManagerId ?? ""} className="w-full">
          <option value="">— none —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="logoUrl">Logo URL (optional)</Label>
        <Input id="logoUrl" name="logoUrl" defaultValue={values.logoUrl ?? ""} placeholder="https://…" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="discountApprovalPct">Discount needing Brand Manager approval (above %)</Label>
        <Input id="discountApprovalPct" name="discountApprovalPct" type="number" min={0} max={100} step="0.01" defaultValue={String(values.discountApprovalPct ?? 3)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="discountEscalationPct">Discount needing Head of Sales approval (above %)</Label>
        <Input id="discountEscalationPct" name="discountEscalationPct" type="number" min={0} max={100} step="0.01" defaultValue={String(values.discountEscalationPct ?? 7)} />
      </div>
      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor="address">Address (printed on quotes, orders and invoices)</Label>
        <Input id="address" name="address" defaultValue={values.address ?? ""} />
      </div>
      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor="bankDetails">Bank details (printed on documents)</Label>
        <Input id="bankDetails" name="bankDetails" defaultValue={values.bankDetails ?? ""} />
      </div>
      <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:col-span-3 sm:grid-cols-3" data-testid="sender-identity">
        <legend className="px-1 text-xs font-semibold">Sender identity – messages about this brand&apos;s records are always sent as this brand</legend>
        <div className="space-y-1">
          <Label htmlFor="fromName">Email from-name</Label>
          <Input id="fromName" name="fromName" maxLength={80} defaultValue={values.fromName ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fromEmail">Email from-address</Label>
          <Input id="fromEmail" name="fromEmail" type="email" defaultValue={values.fromEmail ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="smsSenderId">SMS sender ID (3–11 characters)</Label>
          <Input id="smsSenderId" name="smsSenderId" maxLength={11} defaultValue={values.smsSenderId ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="smsInboundNumber">Number that receives SMS replies</Label>
          <Input id="smsInboundNumber" name="smsInboundNumber" defaultValue={values.smsInboundNumber ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="whatsappNumber">WhatsApp Business number</Label>
          <Input id="whatsappNumber" name="whatsappNumber" placeholder="+234…" defaultValue={values.whatsappNumber ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="whatsappPhoneId">WhatsApp phone-number ID (Cloud API)</Label>
          <Input id="whatsappPhoneId" name="whatsappPhoneId" defaultValue={values.whatsappPhoneId ?? ""} />
        </div>
        <p className="text-xs text-text-muted sm:col-span-3">Inbound messages are routed by the number that received them. Provider credentials are configured in the server environment, never here.</p>
      </fieldset>
      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor="documentTerms">Default terms &amp; conditions</Label>
        <textarea id="documentTerms" name="documentTerms" defaultValue={values.documentTerms ?? ""} className="h-20 w-full rounded-md border border-border bg-background p-2 text-sm" />
      </div>
    </div>
  );
}
