import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveLetterheadAction, saveLetterheadLogoAction } from "@/server/modules/print/actions";
import { letterheadBrands, letterheadForEdit } from "@/server/modules/print/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Letterhead" };

/** The letterhead profile of a brand: what is printed on top of (and under) every printout of that brand. */
export default async function LetterheadPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { ctx, entry } = await requireSetup("letterhead"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const brands = await letterheadBrands(ctx);
  if (!brands.length) notFound();
  const chosen = sp.brand ? brands.find((b) => b.id === sp.brand) : brands[0];
  if (!chosen) notFound(); // a brand outside the user's Setup scope does not exist for them
  const lh = await letterheadForEdit(ctx, chosen.id);
  const field = (name: string, label: string, value: string | null, extra: { type?: string; hint?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={extra.type ?? "text"} defaultValue={value ?? ""} />
      {extra.hint ? <p className="text-xs text-text-muted">{extra.hint}</p> : null}
    </div>
  );
  return (
    <div>
      <SetupHeader entry={entry} />
      {brands.length > 1 ? (
        <form method="get" className="mb-4 flex items-end gap-2">
          <Select name="brand" defaultValue={chosen.id} aria-label="Brand" className="w-64">
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} – {b.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      ) : null}

      <Section title={`Logo of ${lh.code}`} hint="PNG, JPEG or SVG, at most 1 MB. Printed top left, at most 60 mm wide and 20 mm high. Without a logo the brand name is set as a word mark in the brand colour." testId="letterhead-logo">
        {lh.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo from our own API
          <img src={`/api/v1/brands/${lh.id}/logo?v=${Date.now()}`} alt={`${lh.name} logo`} className="max-h-16 max-w-56 rounded border border-border bg-white p-1" />
        ) : (
          <p className="text-text-muted">No logo uploaded.</p>
        )}
        <ActionForm action={saveLetterheadLogoAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="brandId" value={lh.id} />
          <div className="space-y-1">
            <Label htmlFor="logo">Logo file</Label>
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" className="block text-sm" />
          </div>
          <SubmitButton variant="outline" name="_intent" value="upload">
            Upload logo
          </SubmitButton>
          {lh.hasLogo ? (
            <SubmitButton variant="ghost" name="_intent" value="remove">
              Remove logo
            </SubmitButton>
          ) : null}
        </ActionForm>
      </Section>

      <Section title={`Company details of ${lh.code}`} testId="letterhead-form">
        <ActionForm action={saveLetterheadAction} className="space-y-4">
          <input type="hidden" name="brandId" value={lh.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            {field("legalEntity", "Legal entity name", lh.legalEntity, { hint: "Printed top right and in the footer" })}
            {field("rcNumber", "RC number", lh.rcNumber)}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <textarea id="address" name="address" rows={3} defaultValue={lh.address ?? ""} className="crm-input" />
            </div>
            {field("phone", "Phone", lh.phone)}
            {field("contactEmail", "E-mail", lh.contactEmail, { type: "email" })}
            {field("website", "Website", lh.website)}
            {field("vatNumber", "VAT number", lh.vatNumber)}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bankDetails">Bank details (printed on quotes, orders and invoices)</Label>
              <textarea id="bankDetails" name="bankDetails" rows={3} defaultValue={lh.bankDetails ?? ""} className="crm-input" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="color">Brand colour</Label>
              <Input id="color" name="color" type="color" defaultValue={lh.color ?? "#1565d0"} className="h-9 w-24 p-1" />
            </div>
            {field("footerText", "Footer text", lh.footerText, { hint: "One line after the legal name and address" })}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="copyWatermark" defaultChecked={lh.copyWatermark} /> Print “COPY” across quotes, sales orders and invoices after their first print
          </label>
          <div className="flex justify-end">
            <SubmitButton>Save letterhead</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
