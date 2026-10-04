import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { assertAdmin } from "@/server/modules/admin/guard";
import { BRANDED_MODULES, CUSTOM_MODULES, EMPTY_LAYOUT, FIELD_TYPES, LOOKUP_TARGETS, TYPE_LABELS, cfKey, layoutSchema, type CustomFieldType, type CustomModule } from "@/server/modules/customization/engine";
import { layoutToText } from "@/server/modules/customization/layout-text";
import { listCustomFields, listLayouts } from "@/server/modules/customization/service";
import { saveCustomFieldAction, saveLayoutAction, toggleFieldIndexAction } from "@/server/modules/imports/actions";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Fields & layouts" };
const LABEL: Record<CustomModule, string> = { leads: "Leads", deals: "Deals", accounts: "Accounts", contacts: "Contacts", cases: "Cases" };
const area = "w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs";

/** Custom fields and layouts per module (prompt 12). Administrators only. */
export default async function CustomizationPage({ searchParams }: { searchParams: Promise<{ module?: string; edit?: string; brand?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  assertAdmin(ctx);
  const mod = (CUSTOM_MODULES as readonly string[]).includes(sp.module ?? "") ? (sp.module as CustomModule) : "leads";
  const branded = BRANDED_MODULES.includes(mod);
  const [fields, layouts, dir] = await Promise.all([listCustomFields(ctx, mod), listLayouts(ctx, mod), getDirectory(ctx)]);
  const editing = fields.find((f) => f.id === sp.edit) ?? null;
  const layoutBrand = branded ? (dir.brands.find((b) => b.code === sp.brand) ?? null) : null;
  const stored = layouts.find((l) => l.brandId === (layoutBrand?.id ?? null));
  const parsed = stored ? layoutSchema.safeParse(stored.definition) : null;
  const text = layoutToText(parsed?.success ? parsed.data : EMPTY_LAYOUT);
  const tab = "rounded-full border px-3 py-1 text-[13px]";
  const on = "border-primary bg-primary text-primary-foreground";

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1" aria-label="Modules">
        {CUSTOM_MODULES.map((m) => (
          <Link key={m} href={`/admin/customization?module=${m}`} aria-current={m === mod ? "page" : undefined} className={cn(tab, m === mod ? on : "border-border bg-surface hover:bg-muted")}>
            {LABEL[m]}
          </Link>
        ))}
      </nav>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Custom fields – {LABEL[mod]}</h2>
        {fields.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">No custom fields yet.</p>
        ) : (
          <table className="w-full text-[13px]" data-testid="custom-fields">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/admin/customization?module=${mod}&edit=${f.id}`} className="font-medium text-primary hover:underline">
                      {f.label}
                    </Link>
                    {f.required ? <span className="ml-1 text-danger">*</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{cfKey(f.apiName)}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[f.type as CustomFieldType]}</td>
                  <td className="px-3 py-2">{f.brand?.code ?? "All brands"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={f.active ? "success" : "neutral"}>{f.active ? "Active" : "Inactive"}</StatusPill>
                    {f.indexed ? <span className="ml-2 text-xs text-text-muted">indexed</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.type !== "FORMULA" && f.type !== "MULTI_PICKLIST" ? (
                      <ActionForm action={toggleFieldIndexAction}>
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="indexed" value={f.indexed ? "false" : "true"} />
                        <SubmitButton size="sm" variant="ghost">
                          {f.indexed ? "Remove index" : "Index"}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="custom-field-form">
        <h2 className="mb-2 text-[13px] font-semibold">
          {editing ? `Edit field: ${editing.label}` : "New custom field"}
          {editing ? (
            <Link href={`/admin/customization?module=${mod}`} className="ml-3 text-xs font-normal text-primary hover:underline">
              New field instead
            </Link>
          ) : null}
        </h2>
        <ActionForm key={editing?.id ?? "new"} action={saveCustomFieldAction} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="module" value={mod} />
          <div className="space-y-1">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" required maxLength={80} defaultValue={editing?.label ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="apiName">Key (letters and digits, cannot change later)</Label>
            <Input id="apiName" name="apiName" required pattern="[a-z][a-zA-Z0-9]{1,39}" defaultValue={editing?.apiName ?? ""} readOnly={!!editing} className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="type">Type</Label>
            {editing ? <input type="hidden" name="type" value={editing.type} /> : null}
            <Select id="type" name={editing ? undefined : "type"} defaultValue={editing?.type ?? "TEXT"} disabled={!!editing} className="w-full">
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="options">Picklist options (comma or line separated)</Label>
            <Input id="options" name="options" defaultValue={editing?.options.join(", ") ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lookupTarget">Lookup points to</Label>
            <Select id="lookupTarget" name="lookupTarget" defaultValue={editing?.lookupTarget ?? ""} className="w-full">
              <option value="">—</option>
              {LOOKUP_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {t === "users" ? "Users" : "Products"}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="formula">Formula (numbers, + - * / ( ), field names e.g. amount * 0.075)</Label>
            <Input id="formula" name="formula" maxLength={500} defaultValue={editing?.formula ?? ""} className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="brandId">Brand (cannot change later)</Label>
            {editing ? <input type="hidden" name="brandId" value={editing.brandId ?? ""} /> : null}
            <Select id="brandId" name={editing ? undefined : "brandId"} defaultValue={editing?.brandId ?? ""} disabled={!!editing || !branded} className="w-full">
              <option value="">All brands</option>
              {dir.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} only
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="position">Position</Label>
            <Input id="position" name="position" type="number" min={0} max={999} defaultValue={editing?.position ?? 0} className="w-24" />
          </div>
          <div className="flex items-end gap-4 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="required" defaultChecked={editing?.required ?? false} /> Required
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active
            </label>
          </div>
          <div className="flex items-end">
            <SubmitButton>{editing ? "Save field" : "Add field"}</SubmitButton>
          </div>
        </ActionForm>
        <p className="mt-2 text-xs text-text-muted">Field-level security for custom fields is set per profile (Setup → Profiles) under the field key. A brand-specific field is invisible to users of other brands.</p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="layout-editor">
        <h2 className="mb-2 text-[13px] font-semibold">Layout – {LABEL[mod]}</h2>
        {branded ? (
          <nav className="mb-3 flex flex-wrap gap-1" aria-label="Layout variants">
            <Link href={`/admin/customization?module=${mod}`} className={cn(tab, !layoutBrand ? on : "border-border hover:bg-muted")}>
              Default
            </Link>
            {dir.brands.map((b) => (
              <Link key={b.id} href={`/admin/customization?module=${mod}&brand=${b.code}`} className={cn(tab, layoutBrand?.id === b.id ? on : "border-border hover:bg-muted")}>
                {b.code}
                {layouts.some((l) => l.brandId === b.id) ? " •" : ""}
              </Link>
            ))}
          </nav>
        ) : null}
        <ActionForm key={`${mod}:${layoutBrand?.id ?? "default"}`} action={saveLayoutAction} className="space-y-3">
          <input type="hidden" name="module" value={mod} />
          <input type="hidden" name="brandId" value={layoutBrand?.id ?? ""} />
          <div className="space-y-1">
            <Label htmlFor="sections">Sections – one per line: Title: field, field</Label>
            <textarea id="sections" name="sections" rows={3} defaultValue={text.sections} placeholder="Vehicle preferences: cf_colour, cf_trim" className={area} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="required">Additionally required fields</Label>
            <Input id="required" name="required" defaultValue={text.required} placeholder="email, cf_colour" className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rules">Rules – one per line: SHOW | HIDE | REQUIRE fields WHEN field operator value</Label>
            <textarea id="rules" name="rules" rows={4} defaultValue={text.rules} placeholder={"REQUIRE cf_financeBank WHEN paymentType eq FINANCE\nHIDE cf_tradeInVin WHEN cf_hasTradeIn neq true"} className={area} />
            <p className="text-xs text-text-muted">Operators: eq, neq, in, isEmpty, notEmpty, gt, lt. Custom fields use their key (cf_…); standard fields their field name. {layoutBrand ? `This variant replaces the default layout for ${layoutBrand.code}; save it empty to remove it.` : "Brands without their own variant use this default."}</p>
          </div>
          <SubmitButton variant="outline">Save layout</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
