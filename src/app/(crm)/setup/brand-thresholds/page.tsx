import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveBrandThresholdsAction } from "@/server/modules/setup/actions";
import { brandsInSetupScope } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Brand thresholds" };

/** Discount approval thresholds per brand. A Brand Admin sees and changes the own brand(s) only. */
export default async function BrandThresholdsPage() {
  const { ctx, entry } = await requireSetup("brand-thresholds"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const brands = await brandsInSetupScope(ctx, "brand-thresholds");
  if (!brands.length) notFound();
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Discount approval" hint="A discount above the first threshold needs the Brand Manager's approval; above the second, the Head of Sales as well." testId="brand-thresholds">
        <ul className="divide-y divide-border">
          {brands.map((b) => (
            <li key={b.id} className="py-3" data-testid="threshold-row" data-brand={b.code}>
              <ActionForm action={saveBrandThresholdsAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="brandId" value={b.id} />
                <span className="flex w-48 items-center gap-2">
                  <BrandBadge brand={b} /> {b.name}
                </span>
                <div className="space-y-1">
                  <Label htmlFor={`a-${b.id}`}>Brand Manager above (%)</Label>
                  <Input id={`a-${b.id}`} name="discountApprovalPct" type="number" min={0} max={100} step="0.01" defaultValue={String(b.discountApprovalPct)} className="w-32" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`e-${b.id}`}>Head of Sales above (%)</Label>
                  <Input id={`e-${b.id}`} name="discountEscalationPct" type="number" min={0} max={100} step="0.01" defaultValue={String(b.discountEscalationPct)} className="w-32" />
                </div>
                <SubmitButton size="sm" variant="outline">
                  Save
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
