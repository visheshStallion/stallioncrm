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
    </div>
  );
}
