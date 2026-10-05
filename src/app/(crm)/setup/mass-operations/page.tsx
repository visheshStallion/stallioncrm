import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { massDeleteAction, massTransferAction } from "@/server/modules/setup/actions";
import { MASS_MODULES, brandsInSetupScope } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { ReauthFields, Section, SetupHeader } from "../_components";

export const metadata = { title: "Mass delete / mass transfer" };

export default async function MassOperationsPage() {
  const { ctx, entry } = await requireSetup("mass-operations"); // setupPermission: ADMIN (delete: SA + four eyes)
  const brands = await brandsInSetupScope(ctx, "mass-operations");
  const moduleSelect = (id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>Module</Label>
      <Select id={id} name="module" className="w-full">
        {MASS_MODULES.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
  const brandSelect = (id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>Brand</Label>
      <Select id={id} name="brandId" className="w-full" defaultValue="">
        <option value="">Every brand</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} – {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Mass transfer" hint="Moves every record of a module from one owner to another. The new owner must work in the brand and region of each record – otherwise nothing is transferred." testId="mass-transfer">
        <ActionForm action={massTransferAction} className="space-y-3" confirm="Transfer the ownership of all matching records?">
          <div className="grid gap-3 sm:grid-cols-2">
            {moduleSelect("t-module")}
            {brandSelect("t-brand")}
            <div className="space-y-1">
              <Label htmlFor="fromEmail">From owner (e-mail)</Label>
              <Input id="fromEmail" name="fromEmail" type="email" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="toEmail">To owner (e-mail)</Label>
              <Input id="toEmail" name="toEmail" type="email" required />
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton variant="outline">Transfer</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      {ctx.isSuperAdmin ? (
        <Section title="Mass delete" hint="Moves the matching records to the recycle bin (they can be restored until the bin is purged). At least one criterion is required. Preview first; the deletion itself needs a second Super Admin." testId="mass-delete">
          <ActionForm action={massDeleteAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {moduleSelect("d-module")}
              {brandSelect("d-brand")}
              <div className="space-y-1">
                <Label htmlFor="ownerEmail">Owner (e-mail)</Label>
                <Input id="ownerEmail" name="ownerEmail" type="email" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="createdBefore">Created before</Label>
                <Input id="createdBefore" name="createdBefore" type="date" />
              </div>
            </div>
            <ReauthFields id="massdelete" note="Needed for the request only (not for the preview). The records are deleted when a second Super Admin approves." />
            <div className="flex justify-end gap-2">
              <SubmitButton variant="outline" name="_intent" value="preview">
                Preview impact
              </SubmitButton>
              <SubmitButton variant="destructive" name="_intent" value="request">
                Request mass delete
              </SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : (
        <Section title="Mass delete">
          <p className="text-text-muted">Mass delete is a Super Admin function (two-person approval).</p>
        </Section>
      )}
    </div>
  );
}
