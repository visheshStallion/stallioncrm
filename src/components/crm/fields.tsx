"use client";

import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Avatar } from "./primitives";

type Opt = { value: string; label: string };

/** Single-select picklist. */
export function Picklist({ options, placeholder = "—", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Opt[]; placeholder?: string }) {
  return (
    <Select {...props} className={cn("w-full", props.className)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Multi-select picklist as chips (submits repeated `name` values). */
export function MultiPicklist({ name, options, defaultValue = [] }: { name: string; options: Opt[]; defaultValue?: string[] }) {
  const [sel, setSel] = useState(new Set(defaultValue));
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={name}>
      {options.map((o) => {
        const on = sel.has(o.value);
        return (
          <label key={o.value} className={cn("cursor-pointer rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary/10 text-primary" : "border-border")}>
            <input
              type="checkbox"
              name={name}
              value={o.value}
              checked={on}
              className="sr-only"
              onChange={() =>
                setSel((s) => {
                  const n = new Set(s);
                  if (n.has(o.value)) n.delete(o.value);
                  else n.add(o.value);
                  return n;
                })
              }
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/** ₦ amount input with live grouping (submits the plain number). */
export function CurrencyInput({ name, defaultValue, id, required }: { name: string; defaultValue?: number | null; id?: string; required?: boolean }) {
  const fmt = (n: string) => (n === "" ? "" : Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 }));
  const [raw, setRaw] = useState(defaultValue === null || defaultValue === undefined ? "" : String(defaultValue));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-2 text-sm text-text-muted">₦</span>
      <Input
        id={id}
        inputMode="decimal"
        value={fmt(raw)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          if (/^\d*\.?\d{0,2}$/.test(v)) setRaw(v);
        }}
        className="pl-7 text-right"
        aria-label={id ? undefined : name}
        required={required}
      />
      <input type="hidden" name={name} value={raw} />
    </div>
  );
}

/** From / to date inputs. */
export function DateRangePicker({ fromName, toName, from, to }: { fromName: string; toName: string; from?: string; to?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Input type="date" name={fromName} defaultValue={from} aria-label="From" className="w-40" />
      <span className="text-text-muted">–</span>
      <Input type="date" name={toName} defaultValue={to} aria-label="To" className="w-40" />
    </div>
  );
}

/** Owner picker with avatars (eligible users only – the server re-checks access). */
export function OwnerPicker({ name, users, defaultValue }: { name: string; users: Array<{ id: string; name: string }>; defaultValue?: string }) {
  const [v, setV] = useState(defaultValue ?? "");
  const cur = users.find((u) => u.id === v);
  return (
    <div className="flex items-center gap-2">
      {cur ? <Avatar name={cur.name} size={24} /> : null}
      <Picklist name={name} value={v} onChange={(e) => setV(e.target.value)} options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="Choose owner…" aria-label="Owner" />
    </div>
  );
}

/** Lookup restricted to records of one brand (e.g. models of the record's brand). */
export function LookupField({ name, brandId, items, defaultValue, placeholder = "Search…" }: { name: string; brandId: string | null; items: Array<{ id: string; name: string; brandId: string }>; defaultValue?: string | null; placeholder?: string }) {
  const options = items.filter((i) => i.brandId === brandId).map((i) => ({ value: i.id, label: i.name }));
  return <Picklist name={name} options={options} defaultValue={defaultValue ?? ""} placeholder={brandId ? placeholder : "Choose a brand first"} disabled={!brandId} aria-label={name} />;
}

/** Hover-to-edit field: shows the value with a pencil; clicking switches to `editor`. */
export function EditableField({ label, display, editor, canEdit }: { label: string; display: ReactNode; editor: ReactNode; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="group grid grid-cols-[140px_1fr] items-baseline gap-2 border-b border-border/60 py-1.5 text-[13px]">
      <dt className="text-text-muted">{label}</dt>
      <dd className="flex items-center gap-2">
        {editing ? editor : display}
        {canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" aria-label={`Edit ${label}`}>
            <Pencil className="h-3.5 w-3.5 text-text-muted" />
          </button>
        ) : null}
      </dd>
    </div>
  );
}
