import { CurrencyInput } from "@/components/crm/fields";
import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ProductRow } from "@/server/modules/catalogue/queries";
import { CATEGORIES, CATEGORY_LABELS } from "@/server/modules/catalogue/schema";

function F({ label, id, required, children, wide }: { label: string; id: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2" : "space-y-1"}>
      <Label htmlFor={id}>
        {label}
        {required ? <Required /> : null}
      </Label>
      {children}
    </div>
  );
}

/** Product form. The brand is chosen at creation (only brands the user manages) and never changes. */
export function ProductFormFields({ values, brands }: { values?: ProductRow; brands: Array<{ id: string; code: string; name: string }> }) {
  const v = values;
  const brand = brands.find((b) => b.id === v?.brandId);
  return (
    <div className="space-y-4">
      <FormSection title="Product Information">
        <F label="Brand" id="brandId" required>
          {v ? (
            <Input id="brandId" value={brand ? `${brand.code} – ${brand.name}` : ""} readOnly disabled />
          ) : (
            <Select id="brandId" name="brandId" required defaultValue={brands.length === 1 ? brands[0]!.id : ""} className="w-full">
              <option value="">Choose brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </Select>
          )}
        </F>
        <F label="Code / SKU" id="code" required>
          <Input id="code" name="code" defaultValue={v?.code ?? ""} required className="uppercase" />
        </F>
        <F label="Model" id="model" required>
          <Input id="model" name="model" defaultValue={v?.model ?? ""} required />
        </F>
        <F label="Variant / trim" id="variant">
          <Input id="variant" name="variant" defaultValue={v?.variant ?? ""} />
        </F>
        <F label="Category" id="category">
          <Select id="category" name="category" defaultValue={v?.category ?? "VEHICLE"} className="w-full">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </F>
        <F label="Model year" id="modelYear">
          <Input id="modelYear" name="modelYear" type="number" defaultValue={v?.modelYear ?? ""} />
        </F>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="active" defaultChecked={v?.active ?? true} /> Active (shown in pickers)
        </label>
      </FormSection>
      <FormSection title="Specification">
        <F label="Body type" id="bodyType">
          <Input id="bodyType" name="bodyType" defaultValue={v?.bodyType ?? ""} />
        </F>
        <F label="Fuel" id="fuel">
          <Input id="fuel" name="fuel" defaultValue={v?.fuel ?? ""} />
        </F>
        <F label="Transmission" id="transmission">
          <Input id="transmission" name="transmission" defaultValue={v?.transmission ?? ""} />
        </F>
        <F label="Engine (cc)" id="engineCc">
          <Input id="engineCc" name="engineCc" type="number" defaultValue={v?.engineCc ?? ""} />
        </F>
        <F label="Colours (comma separated)" id="colours" wide>
          <Input id="colours" name="colours" defaultValue={v?.colours.join(", ") ?? ""} />
        </F>
        <F label="Description" id="description" wide>
          <Input id="description" name="description" defaultValue={v?.description ?? ""} />
        </F>
      </FormSection>
      <FormSection title="Price & Media">
        <F label="List price (NGN)" id="listPrice">
          <CurrencyInput id="listPrice" name="listPrice" defaultValue={v?.listPrice ?? null} />
        </F>
        <F label="Tax code" id="taxCode">
          <Input id="taxCode" name="taxCode" defaultValue={v?.taxCode ?? "VAT"} />
        </F>
        <F label="Tax rate %" id="taxRatePct">
          <Input id="taxRatePct" name="taxRatePct" type="number" step="0.01" min={0} max={100} defaultValue={v?.taxRatePct ?? 7.5} />
        </F>
        <F label="Spec sheet URL" id="specSheetUrl">
          <Input id="specSheetUrl" name="specSheetUrl" defaultValue={v?.specSheetUrl ?? ""} placeholder="https://…" />
        </F>
        <F label="Image URLs (one per line or comma separated)" id="imageUrls" wide>
          <textarea id="imageUrls" name="imageUrls" defaultValue={v?.imageUrls.join("\n") ?? ""} className="h-20 w-full rounded-md border border-border bg-background p-2 text-sm" />
        </F>
      </FormSection>
    </div>
  );
}
