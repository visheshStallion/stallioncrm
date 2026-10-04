"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { applyRules, cfKey, EMPTY_LAYOUT, fieldsFor, layoutSchema, pickLayout, type CustomFieldDef, type CustomValues, type LayoutDef } from "@/server/modules/customization/engine";
import { FormSection, Required } from "./record";

interface LayoutRow {
  brandId: string | null;
  definition: unknown;
}

/**
 * Custom fields of a record form + the layout rules of the module (prompt 12). Placed inside the record's
 * <form>: it reads the form's own values (brand select, payment type …) to
 *   • show the custom fields that apply to the chosen brand, grouped by the layout's sections,
 *   • show / hide / require fields by the layout rules – custom fields here, standard fields through their
 *     wrapper marked with `data-field="<name>"`.
 * The server validates the same rules again, so this is presentation only.
 */
export function CustomFieldsForm({
  module,
  defs,
  layouts,
  values = {},
  fixedBrandId,
  lookups,
}: {
  module: string;
  defs: CustomFieldDef[];
  layouts: LayoutRow[];
  values?: CustomValues;
  /** edit forms: the record's brand (undefined = follow the form's brand select) */
  fixedBrandId?: string | null;
  lookups: { users: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string; brandId: string }> };
}) {
  const root = useRef<HTMLDivElement>(null);
  const [brandId, setBrandId] = useState<string | null>(fixedBrandId ?? null);
  const [live, setLive] = useState<Record<string, unknown>>({});

  const layout: LayoutDef = useMemo(() => {
    const picked = pickLayout(layouts, brandId);
    const parsed = picked ? layoutSchema.safeParse(picked.definition) : null;
    return parsed?.success ? parsed.data : EMPTY_LAYOUT;
  }, [layouts, brandId]);
  const fields = useMemo(() => fieldsFor(defs, module, brandId).filter((d) => d.type !== "FORMULA"), [defs, module, brandId]);
  const { hidden, required } = useMemo(() => applyRules(layout, live), [layout, live]);

  // Follow the form: brand select and every value the rules may depend on.
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const fd = new FormData(form);
      const next: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) {
        if (typeof v !== "string") continue;
        const key = k.startsWith("cf.") ? cfKey(k.slice(3)) : k;
        next[key] = key in next ? `${String(next[key])},${v}` : v;
      }
      setLive(next);
      if (fixedBrandId === undefined) setBrandId((next.brandId as string) || null);
    };
    read();
    form.addEventListener("change", read);
    form.addEventListener("input", read);
    return () => {
      form.removeEventListener("change", read);
      form.removeEventListener("input", read);
    };
  }, [fixedBrandId]);

  // Standard fields: hide / require their wrappers (`data-field`).
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    form.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
      const key = el.dataset.field!;
      el.hidden = hidden.has(key);
      const input = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=hidden]), select, textarea");
      if (!input) return;
      if (required.has(key) && !input.required) {
        input.required = true;
        input.dataset.ruleRequired = "1";
      } else if (!required.has(key) && input.dataset.ruleRequired) {
        input.required = false;
        delete input.dataset.ruleRequired;
      }
    });
  }, [hidden, required]);

  const visible = fields.filter((d) => !hidden.has(cfKey(d.apiName)));
  const sections = [
    ...layout.sections.map((s) => ({ title: s.title, fields: s.fields.map((k) => visible.find((d) => cfKey(d.apiName) === k)).filter((d): d is CustomFieldDef => !!d) })),
    { title: "Additional Information", fields: visible.filter((d) => !layout.sections.some((s) => s.fields.includes(cfKey(d.apiName)))) },
  ].filter((s) => s.fields.length > 0);

  const input = (d: CustomFieldDef) => {
    const name = `cf.${d.apiName}`;
    const id = `cf-${d.apiName}`;
    const v = values[d.apiName];
    const req = d.required || required.has(cfKey(d.apiName));
    switch (d.type) {
      case "NUMBER":
      case "CURRENCY":
        return <Input id={id} name={name} type="number" step="any" min={d.type === "CURRENCY" ? 0 : undefined} inputMode="decimal" defaultValue={typeof v === "number" ? v : ""} required={req} />;
      case "DATE":
        return <Input id={id} name={name} type="date" defaultValue={typeof v === "string" ? v : ""} required={req} />;
      case "PICKLIST":
        return (
          <Select id={id} name={name} defaultValue={typeof v === "string" ? v : ""} required={req} className="w-full">
            <option value="">—</option>
            {d.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        );
      case "MULTI_PICKLIST":
        return (
          <div id={id} className="flex flex-wrap gap-x-3 gap-y-1 text-sm" role="group" aria-label={d.label}>
            {d.options.map((o) => (
              <label key={o} className="flex items-center gap-1">
                <input type="checkbox" name={name} value={o} defaultChecked={Array.isArray(v) && v.includes(o)} /> {o}
              </label>
            ))}
          </div>
        );
      case "LOOKUP": {
        const options = d.lookupTarget === "products" ? lookups.products.filter((p) => !brandId || p.brandId === brandId) : lookups.users;
        return (
          <Select id={id} name={name} defaultValue={typeof v === "string" ? v : ""} required={req} className="w-full">
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        );
      }
      case "BOOLEAN":
        return <input id={id} name={name} type="checkbox" defaultChecked={v === true} className="h-4 w-4" />;
      default:
        return <Input id={id} name={name} maxLength={500} defaultValue={typeof v === "string" ? v : ""} required={req} />;
    }
  };

  return (
    <div ref={root} className="space-y-4" data-testid="custom-fields">
      {/* tells the server which custom fields were on the form (unchecked boxes send nothing) */}
      <input type="hidden" name="_cfKeys" value={visible.map((d) => d.apiName).join(",")} />
      <input type="hidden" name="_cfMulti" value={visible.filter((d) => d.type === "MULTI_PICKLIST").map((d) => d.apiName).join(",")} />
      <input type="hidden" name="_cfBool" value={visible.filter((d) => d.type === "BOOLEAN").map((d) => d.apiName).join(",")} />
      {sections.map((s) => (
        <FormSection key={s.title} title={s.title}>
          {s.fields.map((d) => (
            <div key={`${d.apiName}:${brandId ?? ""}`} className="space-y-1" data-custom-field={d.apiName}>
              <Label htmlFor={`cf-${d.apiName}`}>
                {d.label}
                {d.required || required.has(cfKey(d.apiName)) ? <Required /> : null}
              </Label>
              {input(d)}
            </div>
          ))}
        </FormSection>
      ))}
    </div>
  );
}
