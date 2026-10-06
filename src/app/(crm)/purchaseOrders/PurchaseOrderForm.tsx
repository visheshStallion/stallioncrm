"use client";

import { CalendarDays, Info, Lock, Truck, User, UserSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { LineItemsGrid, gridPayload, newLine, type GridValue } from "@/components/crm/LineItemsGrid";
import { toast } from "@/components/Toaster";
import { calcDocument } from "@/server/modules/documents/calc";
import type { GridProduct } from "@/server/modules/documents/lookups";
import { poFormDataAction, poProductsAction, quickVendorAction, quickVendorContactAction, savePurchaseOrderAction } from "@/server/modules/inventory/po-actions";
import { NIGERIAN_STATES, PO_CURRENCIES, PO_STATUS_LABELS, type PoFormPart } from "@/server/modules/inventory/po-config";
import type { PoFormData } from "@/server/modules/inventory/purchase-orders";
import { COUNTRIES } from "@/lib/countries";

type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export interface Address {
  street?: string;
  city?: string;
  state?: string;
  code?: string;
  country?: string;
}
export interface PoValues {
  ownerId: string;
  number: string;
  subject: string;
  requisitionNumber: string;
  vendorId: string;
  vendorContactId: string;
  trackingNumber: string;
  poDate: string;
  dueDate: string;
  carrier: string;
  exciseDuty: string;
  salesCommission: string;
  currency: string;
  exchangeRate: string;
  billTo: Address;
  shipTo: Address;
  warehouseId: string;
  terms: string;
  description: string;
  formViewId: string;
}

export interface PurchaseOrderFormProps {
  mode: "create" | "edit" | "clone";
  id?: string;
  status?: string;
  number?: string;
  brands: Array<{ id: string; code: string; name: string }>;
  brandId: string;
  /** lookups of the initial brand (server-rendered) */
  data: PoFormData | null;
  initial?: Partial<PoValues>;
  initialGrid?: GridValue;
  dateFormat: DateFormat;
  /** brands whose PO page layout this user may design (administrator / Brand Admin) */
  designBrands: string[];
  today: string;
  userId: string;
}

const DRAFT_KEY = "stallion:po-draft";
const EMPTY: PoValues = { ownerId: "", number: "", subject: "", requisitionNumber: "", vendorId: "", vendorContactId: "", trackingNumber: "", poDate: "", dueDate: "", carrier: "", exciseDuty: "", salesCommission: "", currency: "NGN", exchangeRate: "1", billTo: {}, shipTo: {}, warehouseId: "", terms: "", description: "", formViewId: "" };
const money = (n: number) => n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ISO date ⇄ the user's date format. */
function toDisplay(iso: string, f: DateFormat) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return f === "MM/DD/YYYY" ? `${mo}/${d}/${y}` : f === "YYYY-MM-DD" ? `${y}-${mo}-${d}` : `${d}/${mo}/${y}`;
}
function fromDisplay(text: string, f: DateFormat): string | null {
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

function Field({ label, htmlFor, children, testId }: { label: ReactNode; htmlFor?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="crm-po-field" data-testid={testId}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="crm-po-label">{label}</span>}
      <div className="relative min-w-0">{children}</div>
    </div>
  );
}

/** Date in the user's format, with a calendar button (the browser's date picker). */
function DateInput({ id, value, onChange, format, label, invalid }: { id: string; value: string; onChange: (iso: string) => void; format: DateFormat; label: string; invalid?: boolean }) {
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
function Lookup(p: {
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

function Money({ id, value, onChange, label, tip, disabled }: { id: string; value: string; onChange: (v: string) => void; label: string; tip: string; disabled?: boolean }) {
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

function AddressBlock({ prefix, value, onChange, hidden }: { prefix: "Billing" | "Shipping"; value: Address; onChange: (a: Address) => void; hidden?: boolean }) {
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

/**
 * Create / Edit / Clone Purchase Order (prompt 25): the reference layout rebuilt with our own CSS – sub-header with
 * the buttons, "Purchase Order Information", "Address Information" with Copy Address, "Purchase Items" (the shared
 * grid), terms, description and the form-view bar. The server re-checks and recomputes everything.
 */
export function PurchaseOrderForm(p: PurchaseOrderFormProps) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(p.brandId);
  const [data, setData] = useState<PoFormData | null>(p.data);
  const [v, setV] = useState<PoValues>(() => ({ ...EMPTY, poDate: p.today, ...p.initial }));
  const [grid, setGrid] = useState<GridValue>(() => p.initialGrid ?? { lines: [newLine({ key: "init0" }, [{ name: "VAT", rate: 7.5 }])], header: { discountType: "PERCENT", discountValue: "0", taxes: [], adjustment: "0" } });
  const [products, setProducts] = useState<Array<GridProduct & { fromVendor: boolean }>>([]);
  const [vendorOnly, setVendorOnly] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [copyOpen, setCopyOpen] = useState<false | "menu" | "warehouse">(false);
  const [dialog, setDialog] = useState<null | "vendor" | "contact">(null);
  const [quick, setQuick] = useState({ name: "", email: "", contactName: "" });
  const [restore, setRestore] = useState<{ at: string; v: PoValues; grid: GridValue; brandId: string } | null>(null);
  const [pending, start] = useTransition();
  const first = useRef(true);

  const upd = useCallback((patch: Partial<PoValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  }, []);

  // lookups and defaults of the brand
  useEffect(() => {
    if (!brandId) return setData(null);
    if (first.current && p.data?.brand.id === brandId) return;
    void poFormDataAction(brandId).then((res) => {
      if (!res.ok) return toast(res.error.message, "error");
      setData(res.data);
    });
  }, [brandId, p.data]);
  // defaults for a new PO once the brand is known: owner, billing = brand's legal address, shipping = receiving warehouse, terms, carrier
  useEffect(() => {
    if (!data || p.mode === "edit") return;
    if (first.current && (p.initial?.billTo || p.mode === "clone")) return;
    setV((cur) => {
      const wh = data.warehouses.find((w) => w.id === data.settings.receivingWarehouseId);
      return {
        ...cur,
        ownerId: cur.ownerId && data.owners.some((o) => o.id === cur.ownerId) ? cur.ownerId : data.owners.some((o) => o.id === p.userId) ? p.userId : "",
        vendorId: data.vendors.some((x) => x.id === cur.vendorId) ? cur.vendorId : "",
        vendorContactId: "",
        carrier: cur.carrier && data.settings.carriers.includes(cur.carrier) ? cur.carrier : data.settings.carriers.includes("FedEx") ? "FedEx" : "",
        billTo: { street: [data.brand.legalEntity, data.brand.address].filter(Boolean).join(", "), country: "Nigeria" },
        shipTo: wh ? { street: wh.address ?? wh.name, country: "Nigeria" } : { country: "Nigeria" },
        warehouseId: wh?.id ?? "",
        terms: data.settings.terms,
      };
    });
  }, [data, p.mode, p.userId, p.initial?.billTo]);
  // the grid's products: brand + vendor (List Price = purchase price)
  useEffect(() => {
    if (!brandId) return setProducts([]);
    void poProductsAction(brandId, v.vendorId || null).then((res) => res.ok && setProducts(res.data));
  }, [brandId, v.vendorId]);
  useEffect(() => {
    first.current = false;
  }, []);

  // unsaved-changes guard, autosave of a new PO every 30 s (restored on reopen)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (p.mode !== "create") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) setRestore(JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }, [p.mode]);
  const latest = useRef({ v, grid, brandId, dirty });
  latest.current = { v, grid, brandId, dirty };
  useEffect(() => {
    if (p.mode !== "create") return;
    const t = window.setInterval(() => {
      if (!latest.current.dirty) return;
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), v: latest.current.v, grid: latest.current.grid, brandId: latest.current.brandId }));
      } catch {
        /* storage unavailable */
      }
    }, 30_000);
    return () => window.clearInterval(t);
  }, [p.mode]);
  const clearDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const cancelHref = p.id ? `/purchaseOrders/${p.id}` : "/purchaseOrders";
  const cancel = () => {
    if (dirty && !window.confirm("Discard the changes to this purchase order?")) return;
    setDirty(false);
    if (p.mode === "create") clearDraft();
    router.push(cancelHref);
  };

  const view = data?.settings.formViews.find((x) => x.id === v.formViewId) ?? null;
  const hide = (part: PoFormPart) => !!view?.hidden.includes(part);
  const rateLocked = v.currency === "NGN" || !data?.canEditRate;

  const setCurrency = (c: string) => upd({ currency: c, exchangeRate: c === "NGN" ? "1" : String(data?.rates[c] ?? "") });
  const vendor = data?.vendors.find((x) => x.id === v.vendorId) ?? null;
  /** a vendor that invoices in another currency switches the PO to it – when Setup → Currencies has a rate for it */
  const pickVendor = (id: string) => {
    const c = data?.vendors.find((x) => x.id === id)?.currency ?? "NGN";
    const rate = c === "NGN" ? 1 : data?.rates[c];
    upd({ vendorId: id, vendorContactId: "", ...(id && p.mode !== "edit" && data?.canSeeCost && rate ? { currency: c, exchangeRate: String(rate) } : {}) });
  };
  const contacts = (data?.contacts ?? []).filter((c) => !v.vendorId || c.vendorId === v.vendorId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!brandId) e.brand = "Choose the brand";
    if (!v.subject.trim()) e.subject = "Enter the subject";
    if (!v.vendorId) e.vendor = "Choose the vendor";
    if (!grid.lines.some((l) => (l.description.trim() || l.productId) && Number(l.qty) > 0)) e.items = "Add at least one purchase item with a quantity";
    if (v.dueDate && v.poDate && v.dueDate < v.poDate) e.dueDate = "The due date cannot be before the PO date";
    if (v.currency !== "NGN" && !(Number(v.exchangeRate) > 0)) e.exchangeRate = "No exchange rate for this currency";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = (mode: "save" | "new") => {
    if (pending) return;
    if (!validate()) return toast("Check the highlighted fields", "error");
    start(async () => {
      const g = gridPayload(grid);
      const payload = {
        brandId,
        ...v,
        number: p.mode === "edit" ? undefined : v.number || undefined,
        lines: g.lines.map((l) => ({ ...l, expectedVins: l.vins, vins: undefined })),
        headerDiscountType: g.headerDiscountType,
        headerDiscountValue: g.headerDiscountValue,
        documentTaxes: g.documentTaxes,
        adjustment: g.adjustment,
      };
      const res = await savePurchaseOrderAction(p.mode === "edit" ? p.id! : null, payload, mode);
      if (!res.ok) return toast(res.error.message, "error");
      setDirty(false);
      if (p.mode === "create") clearDraft();
      toast(res.data.message, "success");
      if (mode === "new") {
        // a fresh form keeping brand, owner, vendor, currency and carrier
        router.push(res.data.redirect);
        router.refresh();
      } else router.push(res.data.redirect);
    });
  };

  // keyboard: Ctrl+S saves, Esc cancels (unless a pop-up is open)
  const saveRef = useRef(save);
  saveRef.current = save;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current("save");
      } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"], [data-testid="grid-popup"], [role="listbox"], [role="menu"]')) {
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // grand total in the PO currency and in naira (the server recomputes it)
  const totals = useMemo(() => {
    const n = (s: string) => Number(s) || 0;
    const r = calcDocument(
      grid.lines.map((l) => ({ qty: n(l.qty), unitPrice: n(l.unitPrice), discountType: l.discountType, discountValue: n(l.discountValue), taxes: l.taxes })),
      { discountType: grid.header.discountType, discountValue: n(grid.header.discountValue), taxes: grid.header.taxes, adjustment: n(grid.header.adjustment), taxMode: data?.grid.taxMode ?? "LINE" },
    );
    const total = r.grandTotal + (data?.settings.addExciseToTotal ? n(v.exciseDuty) : 0);
    return { total, ngn: total * (n(v.exchangeRate) || 0) };
  }, [grid, data, v.exciseDuty, v.exchangeRate]);

  const copy = (what: "b2s" | "s2b" | "company" | "vendor" | { warehouse: string }) => {
    setCopyOpen(false);
    if (what === "b2s") upd({ shipTo: { ...v.billTo } });
    else if (what === "s2b") upd({ billTo: { ...v.shipTo } });
    else if (what === "company") upd({ billTo: { street: [data?.brand.legalEntity, data?.brand.address].filter(Boolean).join(", "), country: "Nigeria" } });
    else if (what === "vendor") {
      if (!vendor) return toast("Choose the vendor first", "error");
      upd({ billTo: { street: [vendor.name, vendor.address].filter(Boolean).join(", "), country: v.billTo.country || "Nigeria" } });
    } else {
      const w = data?.warehouses.find((x) => x.id === what.warehouse);
      if (w) upd({ shipTo: { street: w.address ?? w.name, country: "Nigeria" }, warehouseId: w.id });
    }
  };

  const quickCreate = () =>
    start(async () => {
      if (dialog === "vendor") {
        const res = await quickVendorAction(brandId, quick);
        if (!res.ok) return toast(res.error.message, "error");
        const fresh = await poFormDataAction(brandId);
        if (fresh.ok) setData(fresh.data);
        upd({ vendorId: res.data.id, vendorContactId: "" });
        toast(`Vendor “${res.data.name}” created`, "success");
      } else if (dialog === "contact") {
        const res = await quickVendorContactAction(v.vendorId, { name: quick.name, email: quick.email });
        if (!res.ok) return toast(res.error.message, "error");
        setData((d) => (d ? { ...d, contacts: [...d.contacts, { id: res.data.id, vendorId: res.data.vendorId, name: res.data.name, email: res.data.email }] } : d));
        upd({ vendorContactId: res.data.id });
      }
      setDialog(null);
      setQuick({ name: "", email: "", contactName: "" });
    });

  const canDesign = p.designBrands.includes(brandId);
  const title = p.mode === "edit" ? `Edit Purchase Order${p.number ? ` ${p.number}` : ""}` : p.mode === "clone" ? "Clone Purchase Order" : "Create Purchase Order";
  const shownProducts = vendorOnly ? products.filter((x) => x.fromVendor) : products;
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null);

  return (
    <div data-testid="po-form">
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>{title}</h1>
          {canDesign ? (
            <Link href={`/setup/purchase-orders?brand=${brandId}#form-views`} className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="crm-btn crm-btn-secondary" onClick={cancel} data-testid="po-cancel">
            Cancel
          </button>
          {p.mode !== "edit" ? (
            <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={() => save("new")} data-testid="po-save-new">
              Save and New
            </button>
          ) : null}
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={() => save("save")} data-testid="po-save">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {restore ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]" data-testid="po-restore">
          <span>An unsaved purchase order from {new Date(restore.at).toLocaleString("en-GB")} was kept on this device.</span>
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              if (restore.brandId !== brandId) setBrandId(restore.brandId);
              setV(restore.v);
              setGrid(restore.grid);
              setRestore(null);
              setDirty(true);
            }}
          >
            Restore
          </button>
          <button type="button" className="text-text-muted underline" onClick={() => (clearDraft(), setRestore(null))}>
            Discard
          </button>
        </div>
      ) : null}

      <div className="crm-po-card">
        <datalist id="po-countries">
          {COUNTRIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <section className="crm-po-section" aria-labelledby="po-info">
          <h2 id="po-info" className="crm-po-section-title">
            Purchase Order Information
          </h2>
          <div className="crm-po-fields">
            <Field label="Purchase Order Owner" htmlFor="po-owner">
              <Lookup id="po-owner" label="Purchase Order Owner" value={v.ownerId} options={(data?.owners ?? []).map((o) => ({ id: o.id, label: o.name }))} onChange={(id) => upd({ ownerId: id })} icon={<UserSearch className="h-4 w-4" aria-hidden />} required testId="po-owner" />
            </Field>
            <Field label="PO Number" htmlFor="po-number">
              <input id="po-number" className="crm-po-input" value={p.mode === "edit" ? (p.number ?? "") : v.number} placeholder="Auto-generated" readOnly={p.mode === "edit" || !data?.settings.allowManualNumber} onChange={(e) => upd({ number: e.target.value })} maxLength={60} title={data?.settings.allowManualNumber ? "Leave empty for the next number, or type the external number" : "Generated when you save"} />
            </Field>
            <Field label="Brand / Company" htmlFor="po-brand">
              <select
                id="po-brand"
                className="crm-po-input crm-po-req"
                value={brandId}
                disabled={p.mode === "edit" || p.brands.length === 1}
                aria-required
                onChange={(e) => {
                  setBrandId(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">-None-</option>
                {p.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} – {b.name}
                  </option>
                ))}
              </select>
              {err("brand")}
            </Field>
            <Field label="Vendor Name" htmlFor="po-vendor">
              <Lookup id="po-vendor" label="Vendor Name" value={v.vendorId} options={(data?.vendors ?? []).map((x) => ({ id: x.id, label: x.name, sub: x.email }))} onChange={pickVendor} icon={<Truck className="h-4 w-4" aria-hidden />} required disabled={!brandId} createLabel="+ New vendor" onCreate={data?.canCreateVendor ? () => setDialog("vendor") : undefined} testId="po-vendor" />
              {err("vendor")}
            </Field>
            <Field label="Subject" htmlFor="po-subject">
              <input id="po-subject" className="crm-po-input crm-po-req" value={v.subject} onChange={(e) => upd({ subject: e.target.value })} maxLength={255} aria-required aria-invalid={!!errors.subject || undefined} />
              {err("subject")}
            </Field>
            {hide("trackingNumber") ? null : (
              <Field label="Tracking Number" htmlFor="po-tracking">
                <input id="po-tracking" className="crm-po-input" value={v.trackingNumber} onChange={(e) => upd({ trackingNumber: e.target.value })} maxLength={120} />
              </Field>
            )}
            {hide("requisitionNumber") ? null : (
              <Field label="Requisition Number" htmlFor="po-requisition">
                <input id="po-requisition" className="crm-po-input" value={v.requisitionNumber} onChange={(e) => upd({ requisitionNumber: e.target.value })} maxLength={80} />
              </Field>
            )}
            <Field label="PO Date" htmlFor="po-date">
              <DateInput id="po-date" label="PO Date" value={v.poDate} onChange={(iso) => upd({ poDate: iso })} format={p.dateFormat} />
            </Field>
            {hide("vendorContactId") ? null : (
              <Field label="Contact Name" htmlFor="po-contact">
                <Lookup id="po-contact" label="Contact Name" value={v.vendorContactId} options={contacts.map((c) => ({ id: c.id, label: c.name, sub: c.email }))} onChange={(id) => upd({ vendorContactId: id })} icon={<User className="h-4 w-4" aria-hidden />} disabled={!v.vendorId} placeholder={v.vendorId ? "Search" : "Choose the vendor first"} createLabel="+ New contact" onCreate={data?.canCreateVendor && v.vendorId ? () => setDialog("contact") : undefined} testId="po-contact" />
              </Field>
            )}
            {hide("carrier") ? null : (
              <Field label="Carrier" htmlFor="po-carrier">
                <select id="po-carrier" className="crm-po-input" value={v.carrier} onChange={(e) => upd({ carrier: e.target.value })}>
                  <option value="">-None-</option>
                  {(data?.settings.carriers ?? []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            )}
            {hide("dueDate") ? null : (
              <Field label="Due Date" htmlFor="po-due">
                <DateInput id="po-due" label="Due Date" value={v.dueDate} onChange={(iso) => upd({ dueDate: iso })} format={p.dateFormat} invalid={!!errors.dueDate} />
                {err("dueDate")}
              </Field>
            )}
            {hide("salesCommission") ? null : (
              <Field label="Sales Commission" htmlFor="po-commission">
                <Money id="po-commission" label="Sales Commission" value={v.salesCommission} onChange={(x) => upd({ salesCommission: x })} tip="Commission owed to an agent or broker for this purchase – for reference and reports; not part of the Grand Total" disabled={!data?.canSeeCost} />
              </Field>
            )}
            {hide("exciseDuty") ? null : (
              <Field label="Excise Duty" htmlFor="po-excise">
                <Money id="po-excise" label="Excise Duty" value={v.exciseDuty} onChange={(x) => upd({ exciseDuty: x })} tip={data?.settings.addExciseToTotal ? "Excise duty on the goods – added to the Grand Total (brand setting)" : "Excise duty on the goods – recorded only; the brand does not add it to the Grand Total"} disabled={!data?.canSeeCost} />
              </Field>
            )}
            <Field label="Currency" htmlFor="po-currency">
              <select id="po-currency" className="crm-po-input" value={v.currency} onChange={(e) => setCurrency(e.target.value)} disabled={!data?.canSeeCost}>
                {PO_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor="po-status">
              <select id="po-status" className="crm-po-input" value={p.status ?? "DRAFT"} disabled title="The status changes with the buttons on the purchase order (approval, sending, receiving)">
                {Object.entries(PO_STATUS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {/* the reference leaves the right column empty next to Status; Exchange Rate is on the left below it */}
            <div className="hidden lg:block" aria-hidden />
            <Field label="Exchange Rate" htmlFor="po-rate">
              <div className="crm-po-addon">
                <input id="po-rate" type="number" min={0} step="0.000001" className="crm-po-input" value={v.exchangeRate} readOnly={rateLocked} onChange={(e) => upd({ exchangeRate: e.target.value })} aria-describedby="po-rate-hint" />
                <span className="crm-po-iconbtn cursor-default" title={rateLocked ? (v.currency === "NGN" ? "Naira: always 1" : "From Setup → Currencies – only inventory finance can change it") : "You may change the rate"}>
                  <Lock className="h-4 w-4" aria-label={rateLocked ? "Locked" : "Editable"} />
                </span>
              </div>
              <p id="po-rate-hint" className="mt-1 text-xs text-text-muted" data-testid="po-ngn-total">
                {v.currency === "NGN" ? "₦ per ₦" : `₦ per 1 ${v.currency}`} · Grand Total ≈ ₦{money(totals.ngn)}
              </p>
              {err("exchangeRate")}
            </Field>
          </div>
        </section>

        {hide("address") ? null : (
          <section className="crm-po-section" aria-labelledby="po-address">
            <div className="crm-po-section-title">
              <h2 id="po-address">Address Information</h2>
              <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setCopyOpen(false)}>
                <button type="button" className="crm-btn crm-btn-secondary" aria-haspopup="menu" aria-expanded={!!copyOpen} onClick={() => setCopyOpen((o) => (o ? false : "menu"))} data-testid="copy-address">
                  Copy Address
                </button>
                {copyOpen === "menu" ? (
                  <div className="crm-po-menu right-0 w-64" role="menu">
                    <button type="button" role="menuitem" onClick={() => copy("b2s")}>
                      Copy Billing to Shipping
                    </button>
                    <button type="button" role="menuitem" onClick={() => copy("s2b")}>
                      Copy Shipping to Billing
                    </button>
                    <button type="button" role="menuitem" onClick={() => copy("company")}>
                      Billing from company (brand letterhead)
                    </button>
                    <button type="button" role="menuitem" onClick={() => setCopyOpen("warehouse")}>
                      Shipping from warehouse…
                    </button>
                    <button type="button" role="menuitem" onClick={() => copy("vendor")}>
                      Billing from vendor
                    </button>
                  </div>
                ) : copyOpen === "warehouse" ? (
                  <div className="crm-po-menu right-0 w-64" role="menu" aria-label="Warehouses">
                    {(data?.warehouses ?? []).map((w) => (
                      <button key={w.id} type="button" role="menuitem" onClick={() => copy({ warehouse: w.id })}>
                        {w.name}
                      </button>
                    ))}
                    {data?.warehouses.length ? null : <p className="px-3 py-1.5 text-[13px] text-text-muted">The brand has no warehouse.</p>}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="crm-po-fields">
              <AddressBlock prefix="Billing" value={v.billTo} onChange={(a) => upd({ billTo: a })} />
              <AddressBlock prefix="Shipping" value={v.shipTo} onChange={(a) => upd({ shipTo: a })} />
            </div>
          </section>
        )}

        <section className="crm-po-section" aria-label="Purchase Items">
          {products.some((x) => x.fromVendor) ? (
            <label className="float-right mt-4 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={vendorOnly} onChange={(e) => setVendorOnly(e.target.checked)} /> Show only this vendor&apos;s products
            </label>
          ) : null}
          <LineItemsGrid
            documentType="purchaseOrder"
            value={grid}
            onChange={(g) => (setGrid(g), setDirty(true))}
            products={shownProducts}
            taxOptions={data?.grid.taxes ?? [{ name: "VAT", rate: 7.5 }]}
            taxMode={data?.grid.taxMode ?? "LINE"}
            currency={v.currency}
            brandId={brandId}
            canAdjust={data?.grid.canAdjust ?? true}
            showVins
            requireProduct={data?.grid.requireProduct ?? false}
          />
          {err("items")}
          {!data?.canSeeCost ? <p className="mt-2 text-xs text-text-muted">Prices are filled from the item&apos;s purchase cost when you save.</p> : null}
        </section>

        {hide("terms") ? null : (
          <section className="crm-po-section" aria-labelledby="po-terms-title">
            <h2 id="po-terms-title" className="crm-po-section-title">
              Terms and Conditions
            </h2>
            <Field label="Terms and Conditions" htmlFor="po-terms">
              <textarea id="po-terms" className="crm-po-input" value={v.terms} onChange={(e) => upd({ terms: e.target.value })} maxLength={5000} />
            </Field>
          </section>
        )}
        {hide("description") ? null : (
          <section className="crm-po-section" aria-labelledby="po-desc-title">
            <h2 id="po-desc-title" className="crm-po-section-title">
              Description Information
            </h2>
            <Field label="Description" htmlFor="po-description">
              <textarea id="po-description" className="crm-po-input" value={v.description} onChange={(e) => upd({ description: e.target.value })} maxLength={5000} />
            </Field>
          </section>
        )}
      </div>

      <div className="crm-po-footer" data-testid="po-footer">
        <label htmlFor="po-view" className="text-[13px] text-text-muted">
          Create Form Views
        </label>
        <select id="po-view" className="crm-po-input w-56" value={v.formViewId} onChange={(e) => upd({ formViewId: e.target.value })}>
          <option value="">Standard View</option>
          {(data?.settings.formViews ?? []).map((fv) => (
            <option key={fv.id} value={fv.id}>
              {fv.name}
            </option>
          ))}
        </select>
        {canDesign ? (
          <Link href={`/setup/purchase-orders?brand=${brandId}&newView=1#form-views`} className="crm-btn crm-btn-secondary" data-testid="create-form-page">
            Create a custom form page
          </Link>
        ) : null}
      </div>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={dialog === "vendor" ? "New vendor" : "New contact"} data-testid="po-quick-dialog">
          <button type="button" aria-label="Close" className="crm-overlay" onClick={() => setDialog(null)} />
          <div className="crm-modal w-full max-w-md space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{dialog === "vendor" ? "New vendor" : `New contact at ${vendor?.name ?? "the vendor"}`}</h2>
            <label className="block text-[13px]">
              {dialog === "vendor" ? "Vendor name" : "Name"}
              <input className="crm-po-input crm-po-req mt-1" value={quick.name} onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))} autoFocus />
            </label>
            <label className="block text-[13px]">
              E-mail
              <input type="email" className="crm-po-input mt-1" value={quick.email} onChange={(e) => setQuick((q) => ({ ...q, email: e.target.value }))} />
            </label>
            {dialog === "vendor" ? (
              <label className="block text-[13px]">
                Contact person
                <input className="crm-po-input mt-1" value={quick.contactName} onChange={(e) => setQuick((q) => ({ ...q, contactName: e.target.value }))} />
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="crm-btn crm-btn-secondary" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={pending || quick.name.trim().length < 2} onClick={quickCreate}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
