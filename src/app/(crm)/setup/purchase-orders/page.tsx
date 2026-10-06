import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scopedDb } from "@/server/db";
import { deletePoFormViewAction, savePoFormViewAction, savePoSettingsAction } from "@/server/modules/inventory/po-actions";
import { PO_FORM_PARTS, type PoFormPart } from "@/server/modules/inventory/po-config";
import { poSettings } from "@/server/modules/inventory/purchase-orders";
import { setupBrandIds } from "@/server/modules/setup/access";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Purchase Orders" };

/**
 * Setup of the Create Purchase Order page per brand (prompt 25): Carrier picklist, default terms, excise in the total,
 * typed PO numbers, receiving warehouse, approval limit – and the custom form views ("Create a custom form page").
 */
export default async function PoSettingsPage({ searchParams }: { searchParams: Promise<{ brand?: string; view?: string; newView?: string }> }) {
  const { ctx, entry } = await requireSetup("purchase-order-settings"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const scope = setupBrandIds(ctx);
  const db = scopedDb(ctx);
  const brands = await db.brand.findMany({ where: { status: { not: "INACTIVE" }, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  if (!brands.length) notFound();
  const chosen = sp.brand ? brands.find((b) => b.id === sp.brand || b.code === sp.brand) : brands[0];
  if (!chosen) notFound();
  const [s, warehouses] = await Promise.all([poSettings(ctx, chosen.id), db.warehouse.findMany({ where: { brandId: chosen.id, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const editing = s.formViews.find((v) => v.id === sp.view) ?? null;
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

      <Section title={`Purchase orders of ${chosen.code}`} hint="Applies to new purchase orders of the brand." testId="po-settings">
        <ActionForm action={savePoSettingsAction} className="grid max-w-2xl gap-4">
          <input type="hidden" name="brandId" value={chosen.id} />
          <div className="space-y-1">
            <Label htmlFor="carriers">Carrier picklist (one per line)</Label>
            <textarea id="carriers" name="carriers" defaultValue={s.carriers.join("\n")} className="h-40 w-full rounded-md border border-border bg-background p-2 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="poTerms">Default Terms and Conditions</Label>
            <textarea id="poTerms" name="poTerms" defaultValue={s.terms} className="h-28 w-full rounded-md border border-border bg-background p-2 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="receivingWarehouseId">Default receiving warehouse (Shipping address)</Label>
            <select id="receivingWarehouseId" name="receivingWarehouseId" defaultValue={s.receivingWarehouseId ?? ""} className="crm-select w-72">
              <option value="">— none —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-xs space-y-1">
            <Label htmlFor="poApprovalLimit">Approval above (₦ Grand Total)</Label>
            <Input id="poApprovalLimit" name="poApprovalLimit" type="number" min={0} step="1000" defaultValue={s.approvalLimit} />
            <p className="text-xs text-text-muted">Purchase orders above go to the Brand Manager for approval.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="addExciseToTotal" defaultChecked={s.addExciseToTotal} /> Add excise duty to the Grand Total
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allowManualPoNumber" defaultChecked={s.allowManualNumber} /> Allow a typed (external) PO number – unique
          </label>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Section>

      <div id="form-views">
        <Section title="Form views" hint="A custom form page shows the same purchase order with fewer fields (for example an “Import PO view”). Users pick it in the bar at the bottom of the form; the record keeps the view it was created with." testId="po-form-views">
          {s.formViews.length ? (
            <ul className="mb-4 divide-y divide-border rounded-md border border-border">
              {s.formViews.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid="po-form-view">
                  <span className="font-medium">{v.name}</span>
                  <span className="text-xs text-text-muted">{v.hidden.length ? `hides ${v.hidden.map((h) => PO_FORM_PARTS[h]).join(", ")}` : "shows everything"}</span>
                  <a href={`/setup/purchase-orders?brand=${chosen.id}&view=${v.id}#form-views`} className="ml-auto text-primary underline">
                    Edit
                  </a>
                  <ActionForm action={deletePoFormViewAction} confirm={`Delete the view “${v.name}”?`}>
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
          <ActionForm action={savePoFormViewAction} className="grid max-w-2xl gap-3" key={editing?.id ?? (sp.newView ? "new" : "form")}>
            <input type="hidden" name="brandId" value={chosen.id} />
            <input type="hidden" name="viewId" value={editing?.id ?? ""} />
            <div className="max-w-sm space-y-1">
              <Label htmlFor="view-name">{editing ? "Change the view" : "Create a custom form page"} – name</Label>
              <Input id="view-name" name="name" defaultValue={editing?.name ?? ""} placeholder="Import PO view" autoFocus={!!sp.newView} required minLength={2} maxLength={60} />
            </div>
            <fieldset className="grid gap-1 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Hide</legend>
              {(Object.entries(PO_FORM_PARTS) as Array<[PoFormPart, string]>).map(([k, label]) => (
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
