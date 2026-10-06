import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scopedDb } from "@/server/db";
import { parseRules } from "@/server/modules/documents/config";
import { deleteInvoiceFormViewAction, saveInvoiceFormViewAction, saveInvoiceSettingsAction } from "@/server/modules/documents/invoice-actions";
import { INVOICE_FORM_PARTS } from "@/server/modules/documents/invoice-page";
import { setupBrandIds } from "@/server/modules/setup/access";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Invoices" };

type Part = keyof typeof INVOICE_FORM_PARTS;

/**
 * Setup of the Create Invoice page per brand (prompt 26): payment terms, TIN for companies, Excise Duty and Other
 * Charges in the Grand Total – and the custom form views ("Create a custom form page").
 */
export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<{ brand?: string; view?: string; newView?: string }> }) {
  const { ctx, entry } = await requireSetup("invoice-settings"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const scope = setupBrandIds(ctx);
  const brands = await scopedDb(ctx).brand.findMany({ where: { status: { not: "INACTIVE" }, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, code: true, name: true, documentRules: true }, orderBy: { code: "asc" } });
  if (!brands.length) notFound();
  const chosen = sp.brand ? brands.find((b) => b.id === sp.brand || b.code === sp.brand) : brands[0];
  if (!chosen) notFound();
  const r = parseRules(chosen.documentRules);
  const editing = r.invoiceFormViews.find((v) => v.id === sp.view) ?? null;
  return (
    <div className="space-y-4">
      <SetupHeader entry={entry} />
      {brands.length > 1 ? (
        <form method="get" className="flex items-end gap-2">
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

      <Section title={`Invoices of ${chosen.code}`} hint="Applies to new invoices of the brand. Approval thresholds are in Setup → Brands; required links in Setup → Dependencies." testId="invoice-settings">
        <ActionForm action={saveInvoiceSettingsAction} className="grid max-w-2xl gap-4">
          <input type="hidden" name="brandId" value={chosen.id} />
          <div className="max-w-xs space-y-1">
            <Label htmlFor="paymentTermsDays">Payment terms (days) – Due Date = Invoice Date + days</Label>
            <Input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} max={365} defaultValue={r.paymentTermsDays} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="tinRequiredB2B" defaultChecked={r.tinRequiredB2B} /> TIN required on invoices to companies (account type other than Individual)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="exciseInTotal" defaultChecked={r.exciseInTotal} /> Add Excise Duty to the invoice Grand Total (it is always printed when above 0)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="otherChargesEnabled" defaultChecked={r.otherChargesEnabled} /> Offer “Add Other Charges” (delivery, registration, plates …) and add them to the Grand Total
          </label>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Section>

      <div id="form-views">
        <Section title="Form views" hint="A custom form page shows the same invoice with fewer fields (for example a “Fleet invoice”). Users pick it in the bar at the bottom of the form; the invoice keeps the view it was created with." testId="invoice-form-views">
          {r.invoiceFormViews.length ? (
            <ul className="mb-4 divide-y divide-border rounded-md border border-border">
              {r.invoiceFormViews.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid="invoice-form-view">
                  <span className="font-medium">{v.name}</span>
                  <span className="text-xs text-text-muted">{v.hidden.length ? `hides ${v.hidden.map((h) => INVOICE_FORM_PARTS[h as Part] ?? h).join(", ")}` : "shows everything"}</span>
                  <a href={`/setup/invoice-settings?brand=${chosen.id}&view=${v.id}#form-views`} className="ml-auto text-primary underline">
                    Edit
                  </a>
                  <ActionForm action={deleteInvoiceFormViewAction} confirm={`Delete the view “${v.name}”?`}>
                    <input type="hidden" name="brandId" value={chosen.id} />
                    <input type="hidden" name="viewId" value={v.id} />
                    <SubmitButton size="sm" variant="outline">
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-text-muted">Only the Standard View exists.</p>
          )}
          <ActionForm action={saveInvoiceFormViewAction} className="grid max-w-2xl gap-3" key={editing?.id ?? (sp.newView ? "new" : "form")}>
            <input type="hidden" name="brandId" value={chosen.id} />
            <input type="hidden" name="viewId" value={editing?.id ?? ""} />
            <div className="max-w-sm space-y-1">
              <Label htmlFor="view-name">{editing ? "Change the view" : "Create a custom form page"} – name</Label>
              <Input id="view-name" name="name" defaultValue={editing?.name ?? ""} placeholder="Fleet invoice" autoFocus={!!sp.newView} required minLength={2} maxLength={60} />
            </div>
            <fieldset className="grid gap-1 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Hide</legend>
              {(Object.entries(INVOICE_FORM_PARTS) as Array<[Part, string]>).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="hidden" value={k} defaultChecked={editing?.hidden.includes(k)} /> {label}
                </label>
              ))}
            </fieldset>
            <SubmitButton>{editing ? "Save view" : "Create view"}</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
