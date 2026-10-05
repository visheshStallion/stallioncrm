"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Input } from "@/components/ui/input";
import { saveRecordTemplateAction } from "@/server/modules/templates/actions";

type Value = string | number | boolean | null | { $: string };
export interface EditorField {
  name: string;
  label: string;
  type: "text" | "number" | "bool" | "date" | "select" | "ref";
  options?: string[];
}
interface Child {
  subject: string;
  type: string;
  dueInHours: number;
  priority: string;
}
interface Line {
  productId: string;
  qty: number;
  discountPct: number;
}

interface Props {
  templateId: string | null;
  module: string;
  moduleLabel: string;
  /** new template: choices; existing: fixed */
  brands: Array<{ id: string; label: string; shared: boolean }>;
  group: boolean;
  meta: { brandId: string | null; visibility: string };
  fields: EditorField[];
  hasLines: boolean;
  hasChildren: boolean;
  products: Array<{ id: string; label: string }>;
  emailTemplates: Array<{ id: string; name: string }>;
  documentTemplates: Array<{ id: string; name: string }>;
  initial: { name: string; description: string; fieldValues: Record<string, Value>; lockedFields: string[]; hiddenFields: string[]; lineItems: Line[]; childRecords: Child[]; emailTemplateId: string | null; documentTemplateId: string | null };
  canEdit: boolean;
}

const pretty = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
const isFormula = (v: Value | undefined): v is { $: string } => typeof v === "object" && v !== null;
const label = "block space-y-1 text-xs font-medium text-text-muted";

/** How a default value is entered, by the type of the field. Dates take a formula (today + n days) or a fixed date. */
function ValueInput({ field, value, set, disabled }: { field: EditorField; value: Value | undefined; set: (v: Value | undefined) => void; disabled: boolean }) {
  const id = `rt-${field.name}`;
  if (field.name === "ownerId" || field.name === "regionId") {
    const formula = field.name === "ownerId" ? "currentUser" : "userRegion";
    return (
      <select id={id} className="crm-select w-full" disabled={disabled} value={isFormula(value) ? formula : ""} onChange={(e) => set(e.target.value ? { $: formula } : undefined)}>
        <option value="">No default</option>
        <option value={formula}>{field.name === "ownerId" ? "The user who creates the record" : "The user's own region"}</option>
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select id={id} className="crm-select w-full" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value || undefined)}>
        <option value="">No default</option>
        {field.options!.map((o) => (
          <option key={o} value={o}>
            {pretty(o)}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "bool") {
    return (
      <select id={id} className="crm-select w-full" disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => set(e.target.value === "" ? undefined : e.target.value === "yes")}>
        <option value="">No default</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (field.type === "date") {
    const days = isFormula(value) ? Number(/^today([+-]\d+)d$/.exec(value.$)?.[1] ?? 0) : null;
    const mode = value === undefined || value === null ? "" : days !== null ? "relative" : "fixed";
    return (
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label={`${field.label}: kind of default`} className="crm-select" disabled={disabled} value={mode} onChange={(e) => set(e.target.value === "" ? undefined : e.target.value === "relative" ? { $: "today+30d" } : new Date().toISOString().slice(0, 10))}>
          <option value="">No default</option>
          <option value="relative">Today plus days</option>
          <option value="fixed">A fixed date</option>
        </select>
        {mode === "relative" ? (
          <>
            <Input id={id} type="number" min={-3650} max={3650} className="w-24" disabled={disabled} value={days ?? 0} onChange={(e) => set({ $: `today${Number(e.target.value) < 0 ? "-" : "+"}${Math.abs(Math.round(Number(e.target.value)) || 0)}d` })} />
            <span className="text-xs text-text-muted">days</span>
          </>
        ) : null}
        {mode === "fixed" ? <Input id={id} type="date" className="w-44" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value || undefined)} /> : null}
      </div>
    );
  }
  return <Input id={id} type={field.type === "number" ? "number" : "text"} disabled={disabled} value={value === undefined || value === null || isFormula(value) ? "" : String(value)} placeholder={field.type === "ref" ? "Id of the record (filled by “Save as template”)" : "No default"} onChange={(e) => set(e.target.value === "" ? undefined : field.type === "number" ? Number(e.target.value) : e.target.value)} />;
}

/**
 * Record template editor: the module's fields with a default value each, "lock" (the user cannot change it) and
 * "hide" (applied without showing), tasks created with the record, line items for quotations, and what to send after.
 */
export function RecordTemplateEditor(p: Props) {
  const router = useRouter();
  const [name, setName] = useState(p.initial.name);
  const [description, setDescription] = useState(p.initial.description);
  const [values, setValues] = useState(p.initial.fieldValues);
  const [locked, setLocked] = useState(p.initial.lockedFields);
  const [hidden, setHidden] = useState(p.initial.hiddenFields);
  const [children, setChildren] = useState(p.initial.childRecords);
  const [lines, setLines] = useState(p.initial.lineItems);
  const [emailTemplateId, setEmailTemplateId] = useState(p.initial.emailTemplateId ?? "");
  const [documentTemplateId, setDocumentTemplateId] = useState(p.initial.documentTemplateId ?? "");
  const [visibility, setVisibility] = useState(p.meta.visibility);
  const [brandId, setBrandId] = useState(p.meta.brandId ?? "");
  const [pending, start] = useTransition();
  const disabled = !p.canEdit;
  const isNew = !p.templateId;

  const setValue = (field: string, v: Value | undefined) => {
    setValues((cur) => {
      const next = { ...cur };
      if (v === undefined) delete next[field];
      else next[field] = v;
      return next;
    });
    if (v === undefined) {
      setLocked((l) => l.filter((x) => x !== field));
      setHidden((h) => h.filter((x) => x !== field));
    }
  };
  const toggle = (list: string[], set: (l: string[]) => void, field: string, on: boolean) => set(on ? [...new Set([...list, field])] : list.filter((x) => x !== field));

  const save = () =>
    start(async () => {
      const fd = new FormData();
      if (p.templateId) fd.set("templateId", p.templateId);
      fd.set("payload", JSON.stringify({ meta: { module: p.module, brandId: brandId || null, visibility }, body: { name, description: description || null, fieldValues: values, lockedFields: locked, hiddenFields: hidden, lineItems: lines.filter((l) => l.productId), childRecords: children.filter((c) => c.subject.trim()), emailTemplateId: emailTemplateId || null, documentTemplateId: documentTemplateId || null } }));
      const res = await saveRecordTemplateAction(fd);
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "Saved", "success");
      if (res.data.redirect) router.push(res.data.redirect);
      else router.refresh();
    });

  const shared = p.brands.filter((b) => b.shared);
  return (
    <div className="space-y-4" data-testid="record-template-editor">
      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
        <label className={label}>
          <span>Template name</span>
          <Input value={name} maxLength={100} disabled={disabled} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={label}>
          <span>Description (shown in the picker)</span>
          <Input value={description} maxLength={500} disabled={disabled} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {isNew ? (
          <>
            <label className={label}>
              <span>Who uses the template</span>
              <select
                className="crm-select w-full"
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value);
                  if (e.target.value === "SHARED_BRAND" && !shared.some((b) => b.id === brandId)) setBrandId(shared[0]?.id ?? "");
                }}
              >
                <option value="PERSONAL">Only me (personal)</option>
                {shared.length ? <option value="SHARED_BRAND">Everyone in the brand (shared)</option> : null}
                {p.group ? <option value="PUBLIC_GROUP">All brands (public)</option> : null}
              </select>
            </label>
            {visibility === "PUBLIC_GROUP" ? null : (
              <label className={label}>
                <span>Brand / Company</span>
                <select className="crm-select w-full" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  {visibility === "PERSONAL" ? <option value="">All my brands</option> : null}
                  {(visibility === "SHARED_BRAND" ? shared : p.brands).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : null}
      </section>

      <section className="overflow-x-auto rounded-lg border border-border bg-surface" data-testid="rt-fields">
        <table className="w-full text-[13px]">
          <caption className="border-b border-border px-4 py-2 text-left text-[13px] font-semibold">
            Default values of a new {p.moduleLabel.toLowerCase()} <span className="font-normal text-text-muted">– every value is checked again when the record is created</span>
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
              <th className="px-4 py-2">Field</th>
              <th className="px-4 py-2">Default value</th>
              <th className="px-4 py-2" title="The user cannot change the value">
                Lock
              </th>
              <th className="px-4 py-2" title="The value is applied without showing the field as changeable">
                Hide
              </th>
            </tr>
          </thead>
          <tbody>
            {p.fields.map((f) => {
              const has = values[f.name] !== undefined && values[f.name] !== null && values[f.name] !== "";
              return (
                <tr key={f.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5">
                    <label htmlFor={`rt-${f.name}`}>{f.label}</label>
                  </td>
                  <td className="px-4 py-1.5">
                    <ValueInput field={f} value={values[f.name]} set={(v) => setValue(f.name, v)} disabled={disabled} />
                  </td>
                  <td className="px-4 py-1.5">
                    <input type="checkbox" aria-label={`Lock ${f.label}`} disabled={disabled || !has} checked={locked.includes(f.name)} onChange={(e) => toggle(locked, setLocked, f.name, e.target.checked)} />
                  </td>
                  <td className="px-4 py-1.5">
                    <input type="checkbox" aria-label={`Hide ${f.label}`} disabled={disabled || !has} checked={hidden.includes(f.name)} onChange={(e) => toggle(hidden, setHidden, f.name, e.target.checked)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {p.hasLines ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-4" data-testid="rt-lines">
          <h2 className="text-[13px] font-semibold">
            Line items <span className="font-normal text-text-muted">– prices are not stored: they come from the price book on the day the quotation is created</span>
          </h2>
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className={label}>
                <span>Product</span>
                <select className="crm-select w-72" disabled={disabled} value={l.productId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                  <option value="">Choose…</option>
                  {p.products.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                <span>Quantity</span>
                <Input type="number" min={1} className="w-24" disabled={disabled} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
              </label>
              <label className={label}>
                <span>Discount %</span>
                <Input type="number" min={0} max={100} className="w-24" disabled={disabled} value={l.discountPct} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : x)))} />
              </label>
              <button type="button" className="crm-icon-btn" aria-label={`Remove line ${i + 1}`} disabled={disabled} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                <Trash2 />
              </button>
            </div>
          ))}
          {disabled || lines.length >= 50 ? null : (
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setLines([...lines, { productId: "", qty: 1, discountPct: 0 }])}>
              + Add line item
            </button>
          )}
          {p.products.length === 0 ? <p className="text-xs text-text-muted">Choose a brand for the template to add its products.</p> : null}
        </section>
      ) : null}

      {p.hasChildren ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-4" data-testid="rt-children">
          <h2 className="text-[13px] font-semibold">
            Tasks created with the record <span className="font-normal text-text-muted">– for the user who creates it</span>
          </h2>
          {children.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className={label}>
                <span>Subject</span>
                <Input className="w-72" maxLength={200} disabled={disabled} value={c.subject} onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} />
              </label>
              <label className={label}>
                <span>Kind</span>
                <select className="crm-select" disabled={disabled} value={c.type} onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  <option value="TASK">Task</option>
                  <option value="CALL">Call</option>
                  <option value="MEETING">Meeting</option>
                </select>
              </label>
              <label className={label}>
                <span>Due in (hours)</span>
                <Input type="number" min={0} className="w-24" disabled={disabled} value={c.dueInHours} onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, dueInHours: Math.max(0, Number(e.target.value) || 0) } : x)))} />
              </label>
              <label className={label}>
                <span>Priority</span>
                <select className="crm-select" disabled={disabled} value={c.priority} onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, priority: e.target.value } : x)))}>
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </select>
              </label>
              <button type="button" className="crm-icon-btn" aria-label={`Remove task ${i + 1}`} disabled={disabled} onClick={() => setChildren(children.filter((_, j) => j !== i))}>
                <Trash2 />
              </button>
            </div>
          ))}
          {disabled || children.length >= 20 ? null : (
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setChildren([...children, { subject: "", type: "TASK", dueInHours: 24, priority: "NORMAL" }])}>
              + Add task
            </button>
          )}
        </section>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-2" data-testid="rt-after">
        <h2 className="text-[13px] font-semibold md:col-span-2">
          After the record is created <span className="font-normal text-text-muted">– the e-mail composer opens with these chosen; nothing is sent without the user</span>
        </h2>
        <label className={label}>
          <span>E-mail template</span>
          <select className="crm-select w-full" disabled={disabled} value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)}>
            <option value="">None</option>
            {p.emailTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Document template (attached as PDF)</span>
          <select className="crm-select w-full" disabled={disabled} value={documentTemplateId} onChange={(e) => setDocumentTemplateId(e.target.value)}>
            <option value="">None</option>
            {p.documentTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {p.canEdit ? (
        <div className="flex justify-end">
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={save} data-testid="rt-save">
            {pending ? "Saving…" : isNew ? "Create template" : "Save as a new version"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">You can use this template but not change it.</p>
      )}
    </div>
  );
}
