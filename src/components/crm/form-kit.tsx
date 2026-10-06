"use client";

/**
 * Form kit of the Zoho-style create pages (Purchase Order, Invoice – prompts 25/26): label-right field rows, dates in
 * the user's format, lookups with an icon button, ₦ amounts with a tooltip and the billing / shipping address block.
 */
import { CalendarDays, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/Toaster";
import { NIGERIAN_STATES } from "@/server/modules/inventory/po-config";

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export interface Address {
  street?: string;
  city?: string;
  state?: string;
  code?: string;
  country?: string;
}

/** ISO date ⇄ the user's date format. */
export function toDisplay(iso: string, f: DateFormat) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return f === "MM/DD/YYYY" ? `${mo}/${d}/${y}` : f === "YYYY-MM-DD" ? `${y}-${mo}-${d}` : `${d}/${mo}/${y}`;
}
export function fromDisplay(text: string, f: DateFormat): string | null {
  const t = text.trim();
  if (!t) return "";
  const parts = t.split(/[/.-]/).map((x) => x.trim());
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = f === "YYYY-MM-DD" ? [a, b, c] : f === "MM/DD/YYYY" ? [c, a, b] : [c, b, a];
  const iso = `${y.padStart(4, "20")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function Field({ label, htmlFor, children, testId }: { label: ReactNode; htmlFor?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="crm-po-field" data-testid={testId}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="crm-po-label">{label}</span>}
      <div className="relative min-w-0">{children}</div>
    </div>
  );
}

/** Date in the user's format, with a calendar button (the browser's date picker). */
export function DateInput({ id, value, onChange, format, label, invalid }: { id: string; value: string; onChange: (iso: string) => void; format: DateFormat; label: string; invalid?: boolean }) {
  const [text, setText] = useState(toDisplay(value, format));
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setText(toDisplay(value, format)), [value, format]);
  return (
    <div className="crm-po-addon">
      <input
        id={id}
        className="crm-po-input"
        value={text}
        placeholder={format}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const iso = fromDisplay(text, format);
          if (iso === null) {
            toast(`${label}: use the format ${format}`, "error");
            setText(toDisplay(value, format));
          } else onChange(iso);
        }}
      />
      <button type="button" className="crm-po-iconbtn" aria-label={`Choose ${label.toLowerCase()}`} onClick={() => picker.current?.showPicker?.()}>
        <CalendarDays className="h-4 w-4" aria-hidden />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Lookup: type to search, or open the full list with the icon button; optional "+ New …" entry. */
export function Lookup(p: {
  id: string;
  label: string;
  value: string;
  options: Array<{ id: string; label: string; sub?: string | null }>;
  onChange: (id: string) => void;
  icon: ReactNode;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  createLabel?: string;
  onCreate?: () => void;
  testId?: string;
}) {
  const selected = p.options.find((o) => o.id === p.value) ?? null;
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const t = (q ?? "").toLowerCase().trim();
    return p.options.filter((o) => !t || `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(t)).slice(0, 50);
  }, [q, p.options]);
  const pick = (id: string) => {
    p.onChange(id);
    setQ(null);
    setOpen(false);
  };
  return (
    <div className="relative" data-testid={p.testId} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (setOpen(false), setQ(null))}>
      <div className="crm-po-addon">
        <input
          id={p.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${p.id}-list`}
          aria-label={p.label}
          aria-required={p.required || undefined}
          autoComplete="off"
          className={`crm-po-input${p.required ? " crm-po-req" : ""}`}
          placeholder={p.placeholder ?? "Search"}
          disabled={p.disabled}
          value={q ?? selected?.label ?? ""}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setActive(0))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && shown[active]) {
              e.preventDefault();
              pick(shown[active]!.id);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <button type="button" className="crm-po-iconbtn" aria-label={`Look up ${p.label.toLowerCase()}`} disabled={p.disabled} onClick={() => (setQ(""), setOpen((o) => !o))}>
          {p.icon}
        </button>
      </div>
      {open ? (
        <div className="crm-po-menu" id={`${p.id}-list`} role="listbox" aria-label={`${p.label} options`}>
          {selected && !p.required ? (
            <button type="button" role="option" aria-selected={false} className="text-text-muted" onClick={() => pick("")}>
              — None —
            </button>
          ) : null}
          {shown.map((o, i) => (
            <button key={o.id} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(o.id)}>
              {o.label}
              {o.sub ? <span className="block text-[11px] text-text-muted">{o.sub}</span> : null}
            </button>
          ))}
          {shown.length === 0 ? <p className="px-3 py-1.5 text-[13px] text-text-muted">No match.</p> : null}
          {p.onCreate ? (
            <button type="button" className="border-t border-border text-primary" onClick={() => (setOpen(false), p.onCreate!())}>
              {p.createLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Money({ id, value, onChange, label, tip, disabled }: { id: string; value: string; onChange: (v: string) => void; label: string; tip: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="crm-po-addon flex-1">
        <span className="crm-po-prefix">₦</span>
        <input id={id} type="number" min={0} step="0.01" className="crm-po-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled} />
      </div>
      <span title={tip} role="img" aria-label={tip} className="text-text-muted">
        <Info className="h-4 w-4" aria-hidden />
      </span>
    </div>
  );
}

export function AddressBlock({ prefix, value, onChange, hidden }: { prefix: "Billing" | "Shipping"; value: Address; onChange: (a: Address) => void; hidden?: boolean }) {
  if (hidden) return null;
  const key = prefix.toLowerCase();
  const country = value.country ?? "";
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <Field label={`${prefix} Street`} htmlFor={`${key}-street`}>
        <input id={`${key}-street`} className="crm-po-input" value={value.street ?? ""} onChange={(e) => set("street", e.target.value)} maxLength={300} />
      </Field>
      <Field label={`${prefix} City`} htmlFor={`${key}-city`}>
        <input id={`${key}-city`} className="crm-po-input" value={value.city ?? ""} onChange={(e) => set("city", e.target.value)} maxLength={100} />
      </Field>
      <Field label={`${prefix} State`} htmlFor={`${key}-state`}>
        {country === "Nigeria" ? (
          <select id={`${key}-state`} className="crm-po-input" value={value.state ?? ""} onChange={(e) => set("state", e.target.value)}>
            <option value="">-None-</option>
            {NIGERIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
            {value.state && !(NIGERIAN_STATES as readonly string[]).includes(value.state) ? <option>{value.state}</option> : null}
          </select>
        ) : (
          <input id={`${key}-state`} className="crm-po-input" value={value.state ?? ""} onChange={(e) => set("state", e.target.value)} maxLength={100} />
        )}
      </Field>
      <Field label={`${prefix} Code`} htmlFor={`${key}-code`}>
        <input id={`${key}-code`} className="crm-po-input" value={value.code ?? ""} onChange={(e) => set("code", e.target.value)} maxLength={20} />
      </Field>
      <Field label={`${prefix} Country`} htmlFor={`${key}-country`}>
        <input id={`${key}-country`} className="crm-po-input" list="po-countries" value={country} onChange={(e) => set("country", e.target.value)} placeholder="Search country" maxLength={100} />
      </Field>
    </div>
  );
}

