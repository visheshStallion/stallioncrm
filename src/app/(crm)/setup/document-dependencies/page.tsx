import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveDocumentRulesAction } from "@/server/modules/documents/actions";
import { DOCUMENT_RULES, rulesBrands, rulesFor } from "@/server/modules/documents/rules";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Dependencies" };

/** Which links a brand requires on quotes, sales orders and invoices (default: none – every document can stand alone). */
export default async function DependenciesPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { ctx, entry } = await requireSetup("document-dependencies"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const brands = await rulesBrands(ctx);
  if (!brands.length) notFound();
  const chosen = sp.brand ? brands.find((b) => b.id === sp.brand) : brands[0];
  if (!chosen) notFound();
  const { rules, violations } = await rulesFor(ctx, chosen.id);
  return (
    <div>
      <SetupHeader entry={entry} />
      {brands.length > 1 ? (
        <form method="get" className="mb-4 flex items-end gap-2">
          <select name="brand" defaultValue={chosen.id} aria-label="Brand" className="crm-select w-64">
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} – {b.name}
              </option>
            ))}
          </select>
          <button type="submit" className="crm-btn crm-btn-secondary">
            Show
          </button>
        </form>
      ) : null}
      <Section title={`Dependencies of ${chosen.code} documents`} hint="By default a lead, quote, sales order or invoice can be created on its own and linked later. Switch a rule on to make a link mandatory. Rules apply to new documents; the number shows open documents that would not meet the rule today." testId="document-dependencies">
        <ActionForm action={saveDocumentRulesAction} className="space-y-3">
          <input type="hidden" name="brandId" value={chosen.id} />
          <ul className="space-y-2">
            {Object.entries(DOCUMENT_RULES).map(([key, text]) => (
              <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name={key} defaultChecked={rules[key as keyof typeof rules] === true} /> {text}
                </label>
                {violations[key] ? <span className="crm-pill border-warning/40 bg-warning/10 text-[#7a4f05]">{violations[key]} open document(s) would not meet it</span> : null}
              </li>
            ))}
          </ul>
          <div className="max-w-xs space-y-1">
            <Label htmlFor="discountAmountApproval">Approval for discounts on free-text items above (amount, 0 = off)</Label>
            <Input id="discountAmountApproval" name="discountAmountApproval" type="number" min={0} step="1000" defaultValue={rules.discountAmountApproval} />
            <p className="text-xs text-text-muted">Free-text items have no price-book maximum: a quote whose discount is above this amount goes to the Brand Manager.</p>
          </div>
          <fieldset className="space-y-2 border-t border-border pt-3" data-testid="grid-settings">
            <legend className="text-sm font-semibold">Ordered Items: taxes and totals</legend>
            <p className="text-xs text-text-muted">The first tax is applied to new lines. Leave a row empty to remove it (at most 5).</p>
            {[...rules.taxes, ...Array(Math.max(0, 5 - rules.taxes.length)).fill(null)].slice(0, 5).map((t: { name: string; rate: number } | null, i) => (
              <div key={i} className="flex max-w-md gap-2">
                <Input name="taxName" defaultValue={t?.name ?? ""} placeholder="Tax name" aria-label={`Tax ${i + 1} name`} />
                <Input name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={t?.rate ?? ""} placeholder="%" className="w-28" aria-label={`Tax ${i + 1} rate %`} />
              </div>
            ))}
            <div className="flex flex-wrap gap-4">
              <label className="space-y-1 text-sm">
                <span className="block">Tax applies</span>
                <select name="taxMode" defaultValue={rules.taxMode} className="crm-select w-56">
                  <option value="LINE">Per line (each line its own taxes)</option>
                  <option value="DOCUMENT">Once on the document</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">Rounding</span>
                <select name="roundingMode" defaultValue={rules.roundingMode} className="crm-select w-56">
                  <option value="HALF_UP">Half up (0.5 → 1)</option>
                  <option value="HALF_EVEN">Half even (banker&apos;s)</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="adjustmentManagersOnly" defaultChecked={rules.adjustmentManagersOnly} /> Only managers may enter an Adjustment
            </label>
          </fieldset>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
