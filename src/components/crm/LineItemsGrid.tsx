"use client";

import { ArrowDown, ArrowUp, Copy, GripVertical, MoreHorizontal, PackageSearch, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DropdownMenu } from "@/components/crm/overlays";
import { toast } from "@/components/Toaster";
import { stockUnitsAction } from "@/server/modules/documents/actions";
import { calcDocument, type DiscountType, type TaxMode, type TaxRate } from "@/server/modules/documents/calc";
import type { GridProduct } from "@/server/modules/documents/lookups";
import { amountInWords } from "@/server/modules/messaging/merge";
import { newLine, type GridHeader, type GridLine, type GridValue } from "./line-grid";

export { gridFromLines, gridPayload, newLine, type GridHeader, type GridLine, type GridValue } from "./line-grid";

export interface LineItemsGridProps {
  documentType: "quote" | "salesOrder" | "invoice" | "purchaseOrder";
  value: GridValue;
  onChange?: (v: GridValue) => void;
  products: GridProduct[];
  /** the brand's taxes (the first one is applied to new lines) */
  taxOptions: TaxRate[];
  taxMode: TaxMode;
  currency: string;
  brandId: string;
  readOnly?: boolean;
  canAdjust?: boolean;
  /** vehicle lines show their VINs (sales orders, invoices) */
  showVins?: boolean;
  /** free-text items are not allowed (Setup → Dependencies) */
  requireProduct?: boolean;
  /** the List Price column header (purchase orders: cost) */
  priceLabel?: string;
}

const TITLES: Record<LineItemsGridProps["documentType"], string> = { quote: "Quoted Items", salesOrder: "Ordered Items", invoice: "Invoiced Items", purchaseOrder: "Purchase Items" };
const SYMBOL: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };
export const MAX_GRID_LINES = 200;
const n = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? 0 : Number(s));
const fmt = (v: number) => v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Small anchored pop-up (discount / tax editors). */
function Popup({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label={label} className="absolute right-0 top-full z-30 mt-1 w-64 space-y-2 rounded-lg border border-border bg-surface p-3 text-[13px] shadow-lg" data-testid="grid-popup">
      {children}
    </div>
  );
}

function DiscountEditor({ type, value, base, max, onChange, onClose, symbol }: { type: DiscountType; value: string; base: number; max?: number | null; onChange: (t: DiscountType, v: string) => void; onClose: () => void; symbol: string }) {
  const result = type === "PERCENT" ? (base * Math.min(100, n(value))) / 100 : Math.min(base, n(value));
  const pct = base > 0 ? (result / base) * 100 : 0;
  return (
    <Popup label="Discount" onClose={onClose}>
      <div className="flex gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={type === "PERCENT"} onChange={() => onChange("PERCENT", value)} /> % of amount
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={type === "AMOUNT"} onChange={() => onChange("AMOUNT", value)} /> Amount ({symbol})
        </label>
      </div>
      <input className="crm-input w-full text-right" type="number" min={0} step="0.01" value={value} onChange={(e) => onChange(type, e.target.value)} aria-label={type === "PERCENT" ? "Discount %" : "Discount amount"} />
      <p className="text-xs text-text-muted">
        Discount: <strong className="tabular-nums">{fmt(result)}</strong> ({fmt(pct)} %)
      </p>
      {max !== null && max !== undefined && pct > max + 1e-9 ? <p className="rounded bg-warning/10 px-2 py-1 text-xs text-[#7a4f05]">Above the price book maximum of {max} % – needs approval</p> : null}
      <div className="flex justify-end">
        <button type="button" className="crm-btn crm-btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Popup>
  );
}

function TaxEditor({ options, value, base, onChange, onClose }: { options: TaxRate[]; value: TaxRate[]; base: number; onChange: (t: TaxRate[]) => void; onClose: () => void }) {
  const has = (t: TaxRate) => value.some((v) => v.name === t.name);
  return (
    <Popup label="Taxes" onClose={onClose}>
      <p className="text-xs text-text-muted">Taxes on {fmt(base)}</p>
      <ul className="space-y-1">
        {options.map((t) => (
          <li key={t.name}>
            <label className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={has(t)} onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((v) => v.name !== t.name))} /> {t.name} ({t.rate} %)
              </span>
              <span className="tabular-nums text-text-muted">{has(t) ? fmt((base * t.rate) / 100) : "—"}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="crm-btn crm-btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Popup>
  );
}

/** Product Name: type-ahead over the brand's products (code, name) and stock units (VIN); free text otherwise. */
function ProductInput({ line, products, brandId, row, onPick, onText, readOnly, requireProduct }: { line: GridLine; products: GridProduct[]; brandId: string; row: number; onPick: (p: GridProduct, vin?: string) => void; onText: (s: string) => void; readOnly: boolean; requireProduct: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [units, setUnits] = useState<Array<{ vin: string; productId: string; productName: string }>>([]);
  const id = useId();
  const q = line.description.trim().toLowerCase();
  const hits = useMemo(() => (q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : products).slice(0, 12), [q, products]);
  useEffect(() => {
    if (!open || q.length < 4 || !/^[a-z0-9]+$/i.test(q)) return setUnits([]);
    const t = window.setTimeout(async () => {
      const res = await stockUnitsAction(brandId, { q });
      setUnits(res.ok ? res.data.slice(0, 5) : []);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, open, brandId]);
  const options = [...hits.map((p) => ({ kind: "product" as const, p })), ...units.map((u) => ({ kind: "unit" as const, u }))];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "product") onPick(o.p);
    else {
      const p = products.find((x) => x.id === o.u.productId);
      if (p) onPick(p, o.u.vin);
    }
    setOpen(false);
  };
  const product = products.find((p) => p.id === line.productId);
  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <div className="relative">
        <input
          id={id}
          className="crm-grid-input w-full pr-7"
          value={line.description}
          readOnly={readOnly}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-label={`Row ${row}, Product Name`}
          data-col="product"
          placeholder={requireProduct ? "Search a product" : "Product, or type an item"}
          onFocus={() => !readOnly && setOpen(true)}
          onChange={(e) => {
            onText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown" && options.length) {
              e.preventDefault();
              e.stopPropagation();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp" && options.length) {
              e.preventDefault();
              e.stopPropagation();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && options[active] && q) {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <Search className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
      </div>
      {product?.stock ? (
        <p className="mt-1 text-[11px] text-text-muted" data-testid="stock-indicator">
          In stock {product.stock.inStock} · Reserved {product.stock.reserved} · In transit {product.stock.inTransit}
        </p>
      ) : !line.productId && line.description && !readOnly ? (
        <p className="mt-1 text-[11px] text-text-muted">{requireProduct ? "Choose a product – free-text items are not allowed for this brand" : "Free-text item"}</p>
      ) : null}
      {open && options.length && !readOnly ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Products" className="absolute z-20 mt-1 max-h-64 w-[min(28rem,80vw)] overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg" data-testid="product-options">
          {options.map((o, i) => (
            <li
              key={o.kind === "product" ? o.p.id : `u-${o.u.vin}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 text-[13px] ${i === active ? "bg-muted" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              {o.kind === "product" ? (
                <>
                  <span className="font-medium">{o.p.name}</span> <span className="text-xs text-text-muted">{o.p.code}</span>
                  {o.p.price !== null ? <span className="float-right tabular-nums text-xs text-text-muted">{fmt(o.p.price)}</span> : null}
                </>
              ) : (
                <>
                  <span className="font-mono text-xs">{o.u.vin}</span> <span className="text-xs text-text-muted">· {o.u.productName} (in stock)</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** VINs of a vehicle line: chips, a VIN input and "Pick from stock". One VIN per unit. */
function VinField({ line, brandId, row, onChange, readOnly }: { line: GridLine; brandId: string; row: number; onChange: (vins: string[]) => void; readOnly: boolean }) {
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [units, setUnits] = useState<Array<{ vin: string; colour: string | null; location: string | null }>>([]);
  const max = Math.max(1, Math.ceil(n(line.qty)));
  const add = (v: string) => {
    const vin = v.trim().toUpperCase();
    if (!vin) return;
    if (line.vins.includes(vin)) return toast(`VIN ${vin} is already on this line`, "error");
    if (line.vins.length >= max) return toast(`This line has ${max} unit(s) – one VIN per unit`, "error");
    onChange([...line.vins, vin]);
    setText("");
  };
  const pick = async () => {
    setPicking(true);
    const res = await stockUnitsAction(brandId, { productId: line.productId || undefined });
    setUnits(res.ok ? res.data.filter((u) => !line.vins.includes(u.vin)) : []);
  };
  return (
    <div className="mt-2 space-y-1" data-testid="vin-field">
      <div className="flex flex-wrap gap-1">
        {line.vins.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {v}
            {readOnly ? null : (
              <button type="button" aria-label={`Remove VIN ${v}`} onClick={() => onChange(line.vins.filter((x) => x !== v))}>
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <span className="text-[11px] text-text-muted">
          VIN {line.vins.length}/{max}
        </span>
      </div>
      {readOnly || line.vins.length >= max ? null : (
        <div className="flex gap-1">
          <input className="crm-grid-input h-7 min-w-0 flex-1 font-mono text-xs uppercase" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add(text))} placeholder="VIN" aria-label={`Row ${row}, VIN`} />
          <button type="button" className="crm-btn crm-btn-secondary h-7 px-2 text-xs" onClick={() => void pick()} title="Pick from stock">
            <PackageSearch className="h-3.5 w-3.5" aria-hidden /> Stock
          </button>
        </div>
      )}
      {picking ? (
        <div className="rounded border border-border bg-surface p-1 text-xs shadow" role="listbox" aria-label="Units in stock">
          {units.length ? (
            units.map((u) => (
              <button key={u.vin} type="button" role="option" aria-selected={false} className="block w-full rounded px-2 py-1 text-left hover:bg-muted" onClick={() => (add(u.vin), setPicking(false))}>
                <span className="font-mono">{u.vin}</span> {u.colour ? `· ${u.colour}` : ""} {u.location ? `· ${u.location}` : ""}
              </button>
            ))
          ) : (
            <p className="px-2 py-1 text-text-muted">No unit of this product in stock.</p>
          )}
          <button type="button" className="px-2 py-1 text-primary underline" onClick={() => setPicking(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** "+ Add multiple products": search, filters, a checkbox and a quantity per product → one line each. */
function MultiPicker({ products, onAdd, onClose }: { products: GridProduct[]; onAdd: (items: Array<{ p: GridProduct; qty: number }>) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [inStock, setInStock] = useState(false);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const categories = [...new Set(products.map((p) => p.category))].sort();
  const shown = products.filter((p) => (!q || `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase())) && (!category || p.category === category) && (!inStock || (p.stock?.inStock ?? 0) > 0));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add multiple products" data-testid="multi-picker">
      <button type="button" aria-label="Close" className="crm-overlay" onClick={onClose} />
      <div className="crm-modal flex max-h-[85vh] w-full max-w-3xl flex-col">
        <header className="crm-modal-header">
          <h2>Add multiple products</h2>
        </header>
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <input className="crm-input min-w-48 flex-1" placeholder="Search model, variant, code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" autoFocus />
          <select className="crm-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock
          </label>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-border px-1 py-1.5 text-[13px] last:border-0">
              <input type="checkbox" checked={p.id in chosen} onChange={(e) => setChosen((c) => (e.target.checked ? { ...c, [p.id]: 1 } : Object.fromEntries(Object.entries(c).filter(([k]) => k !== p.id))))} aria-label={`Select ${p.name}`} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{p.name}</span> <span className="text-xs text-text-muted">{p.code}</span>
                {p.stock ? <span className="block text-[11px] text-text-muted">In stock {p.stock.inStock} · Reserved {p.stock.reserved} · In transit {p.stock.inTransit}</span> : null}
              </span>
              <span className="tabular-nums text-text-muted">{p.price !== null ? fmt(p.price) : "—"}</span>
              <input type="number" min={1} className="crm-input w-20 text-right" disabled={!(p.id in chosen)} value={chosen[p.id] ?? 1} onChange={(e) => setChosen((c) => ({ ...c, [p.id]: Math.max(1, Number(e.target.value) || 1) }))} aria-label={`Quantity of ${p.name}`} />
            </li>
          ))}
          {shown.length === 0 ? <li className="p-4 text-center text-sm text-text-muted">No product matches.</li> : null}
        </ul>
        <footer className="flex items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-sm text-text-muted">{Object.keys(chosen).length} selected</span>
          <span className="flex gap-2">
            <button type="button" className="crm-btn crm-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              disabled={!Object.keys(chosen).length}
              onClick={() => onAdd(Object.entries(chosen).map(([id, qty]) => ({ p: products.find((x) => x.id === id)!, qty })))}
              data-testid="multi-picker-add"
            >
              Add {Object.keys(chosen).length || ""} line(s)
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Rows pasted from Excel: product / code, quantity, price – shown first, then added. */
function PastePreview({ rows, onConfirm, onClose }: { rows: Array<{ name: string; qty: number; price: number | null; product: GridProduct | null }>; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Paste rows" data-testid="paste-preview">
      <button type="button" aria-label="Close" className="crm-overlay" onClick={onClose} />
      <div className="crm-modal w-full max-w-2xl">
        <header className="crm-modal-header">
          <h2>Add {rows.length} pasted row(s)</h2>
        </header>
        <div className="max-h-[60vh] overflow-auto p-3">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th>Item</th>
                <th>Matched product</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1">{r.name}</td>
                  <td>{r.product ? r.product.name : <span className="text-text-muted">free-text item</span>}</td>
                  <td className="text-right">{r.qty}</td>
                  <td className="text-right tabular-nums">{r.price !== null ? fmt(r.price) : r.product?.price !== null && r.product ? fmt(r.product.price ?? 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border p-3">
          <button type="button" className="crm-btn crm-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="crm-btn crm-btn-primary" onClick={onConfirm} data-testid="paste-confirm">
            Add rows
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Ordered Items grid (prompt 24): S.NO, Product Name (+ Description, VINs), Quantity, List Price, Amount, Discount,
 * Tax and Total for as many lines as needed; add row / add multiple products / paste from Excel / duplicate / insert /
 * reorder / delete; discount and tax pop-ups; totals with document discount, tax and adjustment. Every figure shown
 * comes from the same calculation the server runs at save – the server's values win.
 */
export function LineItemsGrid(p: LineItemsGridProps) {
  const ro = !!p.readOnly;
  const { lines, header } = p.value;
  const sym = SYMBOL[p.currency] ?? p.currency;
  const [popup, setPopup] = useState<{ key: string; kind: "discount" | "tax" } | null>(null);
  const [docPopup, setDocPopup] = useState<"discount" | "tax" | null>(null);
  const [picker, setPicker] = useState(false);
  const [paste, setPaste] = useState<Array<{ name: string; qty: number; price: number | null; product: GridProduct | null }> | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const productOf = (id: string) => p.products.find((x) => x.id === id);
  const calc = useMemo(
    () =>
      calcDocument(
        lines.map((l) => ({ qty: n(l.qty), unitPrice: n(l.unitPrice), discountType: l.discountType, discountValue: n(l.discountValue), taxes: l.taxes, maxDiscountPct: productOf(l.productId)?.maxDiscountPct ?? null })),
        { discountType: header.discountType, discountValue: n(header.discountValue), taxes: header.taxes, adjustment: n(header.adjustment), taxMode: p.taxMode },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- products only matter through maxDiscountPct
    [lines, header, p.taxMode, p.products],
  );

  const emit = (next: GridLine[], h: GridHeader = header) => p.onChange?.({ lines: next, header: h });
  const set = (key: string, patch: Partial<GridLine>) => emit(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const defaultTaxes = p.taxMode === "LINE" ? p.taxOptions.slice(0, 1) : [];
  const focusRow = (key: string, col = "product") => window.setTimeout(() => tableRef.current?.querySelector<HTMLElement>(`[data-row="${key}"] [data-col="${col}"]`)?.focus(), 0);
  const addRow = (at?: number) => {
    if (lines.length >= MAX_GRID_LINES) return toast(`At most ${MAX_GRID_LINES} lines per document`, "error");
    const l = newLine({}, defaultTaxes);
    const next = [...lines];
    next.splice(at ?? next.length, 0, l);
    emit(next);
    focusRow(l.key);
  };
  const fromProduct = (pr: GridProduct, qty = 1, vin?: string): Partial<GridLine> => ({
    productId: pr.id,
    description: pr.name,
    itemCode: pr.code,
    uom: pr.uom ?? "",
    unitPrice: pr.price === null ? "" : String(pr.price),
    taxes: p.taxMode === "LINE" ? (pr.taxRatePct > 0 ? [{ name: p.taxOptions[0]?.name ?? "VAT", rate: pr.taxRatePct }] : []) : [],
    qty: String(pr.vehicle ? Math.max(1, qty) : qty),
    isStockItem: pr.vehicle,
    vins: vin ? [vin] : [],
  });
  const move = (i: number, to: number) => {
    if (to < 0 || to >= lines.length) return;
    const next = [...lines];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x!);
    emit(next);
  };
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ro) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addRow();
      return;
    }
    const t = e.target as HTMLElement;
    const col = t.dataset.col;
    const rowKey = t.closest<HTMLElement>("[data-row]")?.dataset.row;
    if (!col || !rowKey) return;
    const i = lines.findIndex((l) => l.key === rowKey);
    if (e.key === "Enter" && (col === "qty" || col === "price") && i === lines.length - 1) {
      e.preventDefault();
      addRow();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && col !== "product" && col !== "details") {
      const j = e.key === "ArrowDown" ? i + 1 : i - 1;
      if (lines[j]) {
        e.preventDefault();
        focusRow(lines[j]!.key, col);
      }
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (ro) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") || !text.includes("\n") && text.split("\t").length < 2) return;
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.split("\t").map((c) => c.trim()))
      .filter((c) => c[0]);
    if (!rows.length) return;
    e.preventDefault();
    const num = (s: string | undefined) => (s ? Number(s.replace(/[^\d.-]/g, "")) : NaN);
    setPaste(
      rows.slice(0, MAX_GRID_LINES - lines.length).map((c) => {
        const key = c[0]!.toLowerCase();
        const product = p.products.find((x) => x.code.toLowerCase() === key || x.name.toLowerCase() === key) ?? null;
        const qty = num(c[1]);
        const price = num(c[2]);
        return { name: c[0]!, qty: Number.isFinite(qty) && qty > 0 ? qty : 1, price: Number.isFinite(price) ? price : null, product };
      }),
    );
  };

  const empty = lines.length === 1 && !lines[0]!.description && !lines[0]!.productId;
  const cells = (l: GridLine, i: number) => {
    const c = calc.lines[i]!;
    const pr = productOf(l.productId);
    return { c, pr, needs: c.needsApproval || l.needsApproval };
  };

  return (
    <section className="space-y-3" data-testid="line-items-grid" aria-label={TITLES[p.documentType]} ref={topRef}>
      <h2 className="crm-grid-title">{TITLES[p.documentType]}</h2>
      {lines.length > 50 ? (
        <p className="text-xs text-text-muted" data-testid="line-counter">
          {lines.length} / {MAX_GRID_LINES} lines
        </p>
      ) : null}

      {/* desktop / tablet: the grid */}
      <div className="crm-grid hidden md:block" ref={tableRef} onKeyDown={onGridKey} onPaste={onPaste}>
        <table className="crm-grid-table">
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "23.5%" }} />
            <col style={{ width: "7.5%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11.5%" }} />
            <col style={{ width: "11.5%" }} />
            <col style={{ width: "10.5%" }} />
            <col style={{ width: "12.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="crm-grid-sticky0 text-center">S.NO</th>
              <th className="crm-grid-sticky1 crm-grid-required">Product Name</th>
              <th>Quantity</th>
              <th>{p.priceLabel ?? "List Price"}({sym})</th>
              <th>Amount({sym})</th>
              <th>Discount({sym})</th>
              <th>Tax({sym})</th>
              <th>Total({sym})</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const { c, pr, needs } = cells(l, i);
              return (
                <tr
                  key={l.key}
                  data-row={l.key}
                  data-testid="grid-row"
                  className={drag === l.key ? "opacity-50" : undefined}
                  draggable={!ro}
                  onDragStart={(e) => {
                    if ((e.target as HTMLElement).closest("input, textarea")) return e.preventDefault();
                    setDrag(l.key);
                  }}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => drag && e.preventDefault()}
                  onDrop={() => {
                    const from = lines.findIndex((x) => x.key === drag);
                    if (from >= 0) move(from, i);
                    setDrag(null);
                  }}
                >
                  <td className="crm-grid-sticky0 crm-grid-sno">
                    <span data-testid="row-number">{i + 1}</span>
                    {ro ? null : (
                      <span className="crm-grid-rowtools">
                        <span className="cursor-grab text-text-muted" title="Drag to reorder" aria-hidden>
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <button type="button" className="text-text-muted hover:text-danger" aria-label={`Delete row ${i + 1}`} onClick={() => emit(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [newLine({}, defaultTaxes)])}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <DropdownMenu
                          label={`Row ${i + 1} actions`}
                          align="left"
                          trigger={({ toggle, open, id }) => (
                            <button type="button" className="text-text-muted" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label={`Row ${i + 1} actions`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        >
                          {(close) => (
                            <>
                              {(
                                [
                                  ["Duplicate line", () => lines.length < MAX_GRID_LINES && emit([...lines.slice(0, i + 1), { ...l, key: newLine().key, id: undefined, vins: [] }, ...lines.slice(i + 1)]), Copy],
                                  ["Insert row above", () => addRow(i), Plus],
                                  ["Insert row below", () => addRow(i + 1), Plus],
                                  ["Move up", () => move(i, i - 1), ArrowUp],
                                  ["Move down", () => move(i, i + 1), ArrowDown],
                                ] as const
                              ).map(([label, fn, Icon]) => (
                                <button key={label} type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), fn())}>
                                  <Icon className="h-4 w-4" aria-hidden /> {label}
                                </button>
                              ))}
                            </>
                          )}
                        </DropdownMenu>
                      </span>
                    )}
                  </td>
                  <td className="crm-grid-sticky1">
                    <ProductInput
                      line={l}
                      products={p.products}
                      brandId={p.brandId}
                      row={i + 1}
                      readOnly={ro}
                      requireProduct={!!p.requireProduct}
                      onPick={(prod, vin) => set(l.key, fromProduct(prod, n(l.qty) || 1, vin))}
                      onText={(s) => set(l.key, { description: s, productId: l.productId && s !== productOf(l.productId)?.name ? "" : l.productId })}
                    />
                    <textarea className="crm-grid-textarea" placeholder="Description" value={l.details} readOnly={ro} onChange={(e) => set(l.key, { details: e.target.value })} aria-label={`Row ${i + 1}, Description`} data-col="details" />
                    {p.showVins && (l.isStockItem || pr?.vehicle || l.vins.length) ? <VinField line={l} brandId={p.brandId} row={i + 1} readOnly={ro} onChange={(vins) => set(l.key, { vins, isStockItem: true })} /> : null}
                    {needs ? (
                      <p className="mt-1 text-[11px] font-semibold text-[#7a4f05]" data-testid="needs-approval">
                        Needs approval
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <input className="crm-grid-input w-[90px] max-w-full" type="number" min={0} step="1" value={l.qty} readOnly={ro} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label={`Row ${i + 1}, Quantity`} data-col="qty" />
                  </td>
                  <td>
                    <input className="crm-grid-input w-[110px] max-w-full" type="number" min={0} step="0.01" value={l.unitPrice} readOnly={ro} onChange={(e) => set(l.key, { unitPrice: e.target.value })} aria-label={`Row ${i + 1}, ${p.priceLabel ?? "List Price"}`} data-col="price" />
                  </td>
                  <td>
                    <output className="crm-grid-readonly w-[150px]" aria-label={`Row ${i + 1}, Amount`}>
                      {fmt(c.amount)}
                    </output>
                  </td>
                  <td className="relative">
                    <button type="button" className="crm-grid-readonly crm-grid-clickable w-[120px]" disabled={ro} onClick={() => setPopup({ key: l.key, kind: "discount" })} aria-label={`Row ${i + 1}, Discount ${fmt(c.discountAmount)} – change`} data-col="discount">
                      {fmt(c.discountAmount)}
                    </button>
                    {popup?.key === l.key && popup.kind === "discount" ? (
                      <DiscountEditor type={l.discountType} value={l.discountValue} base={c.amount} max={pr?.maxDiscountPct} symbol={sym} onChange={(t, v) => set(l.key, { discountType: t, discountValue: v })} onClose={() => setPopup(null)} />
                    ) : null}
                  </td>
                  <td className="relative">
                    <button type="button" className="crm-grid-readonly crm-grid-clickable w-[107px]" disabled={ro || p.taxMode === "DOCUMENT"} onClick={() => setPopup({ key: l.key, kind: "tax" })} aria-label={`Row ${i + 1}, Tax ${fmt(c.taxAmount)}${p.taxMode === "LINE" ? " – change" : " (document level)"}`} data-col="tax">
                      {fmt(c.taxAmount)}
                    </button>
                    {popup?.key === l.key && popup.kind === "tax" ? <TaxEditor options={p.taxOptions} value={l.taxes} base={c.net} onChange={(t) => set(l.key, { taxes: t })} onClose={() => setPopup(null)} /> : null}
                  </td>
                  <td>
                    <output className="crm-grid-readonly w-[150px]" aria-label={`Row ${i + 1}, Total`} data-testid="row-total">
                      {fmt(c.total)}
                    </output>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* phones: one card per line, edited in a bottom sheet */}
      <ul className="space-y-2 md:hidden" data-testid="grid-cards">
        {lines.map((l, i) => {
          const { c, needs } = cells(l, i);
          return (
            <li key={l.key} className="rounded-lg border border-border bg-surface p-3 text-[13px]" data-testid="grid-card">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">
                  {i + 1}. {l.description || "New line"}
                </span>
                <span className="tabular-nums font-semibold">{fmt(c.total)}</span>
              </div>
              <p className="text-xs text-text-muted">
                {l.qty} × {fmt(n(l.unitPrice))} · Discount {fmt(c.discountAmount)} · Tax {fmt(c.taxAmount)}
              </p>
              {needs ? <p className="text-[11px] font-semibold text-[#7a4f05]">Needs approval</p> : null}
              {ro ? null : (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="crm-btn crm-btn-secondary h-8" onClick={() => setSheet(l.key)}>
                    Edit line
                  </button>
                  <button type="button" className="crm-btn crm-btn-secondary h-8" aria-label={`Delete line ${i + 1}`} onClick={() => emit(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [newLine({}, defaultTaxes)])}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sheet
        ? (() => {
            const i = lines.findIndex((x) => x.key === sheet);
            const l = lines[i];
            if (!l) return null;
            return (
              <div className="fixed inset-0 z-50 flex items-end md:hidden" role="dialog" aria-modal="true" aria-label={`Edit line ${i + 1}`} data-testid="line-sheet">
                <button type="button" aria-label="Close" className="crm-overlay" onClick={() => setSheet(null)} />
                <div className="relative max-h-[85vh] w-full space-y-2 overflow-auto rounded-t-xl bg-surface p-4">
                  <h2 className="text-[15px] font-semibold">Line {i + 1}</h2>
                  <ProductInput line={l} products={p.products} brandId={p.brandId} row={i + 1} readOnly={false} requireProduct={!!p.requireProduct} onPick={(prod, vin) => set(l.key, fromProduct(prod, n(l.qty) || 1, vin))} onText={(s) => set(l.key, { description: s })} />
                  <textarea className="crm-grid-textarea" placeholder="Description" value={l.details} onChange={(e) => set(l.key, { details: e.target.value })} aria-label="Description" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-text-muted">
                      Quantity
                      <input className="crm-grid-input w-full" type="number" min={0} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                    </label>
                    <label className="text-xs text-text-muted">
                      {p.priceLabel ?? "List Price"} ({sym})
                      <input className="crm-grid-input w-full" type="number" min={0} value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} />
                    </label>
                    <label className="text-xs text-text-muted">
                      Discount
                      <select className="crm-select w-full" value={l.discountType} onChange={(e) => set(l.key, { discountType: e.target.value as DiscountType })}>
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">{sym}</option>
                      </select>
                    </label>
                    <label className="text-xs text-text-muted">
                      Discount value
                      <input className="crm-grid-input w-full" type="number" min={0} value={l.discountValue} onChange={(e) => set(l.key, { discountValue: e.target.value })} />
                    </label>
                  </div>
                  {p.showVins && (l.isStockItem || productOf(l.productId)?.vehicle) ? <VinField line={l} brandId={p.brandId} row={i + 1} readOnly={false} onChange={(vins) => set(l.key, { vins, isStockItem: true })} /> : null}
                  <button type="button" className="crm-btn crm-btn-primary w-full" onClick={() => setSheet(null)}>
                    Done
                  </button>
                </div>
              </div>
            );
          })()
        : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {ro ? null : (
            <>
              <button type="button" className="crm-btn crm-btn-outline-primary" onClick={() => addRow()} data-testid="add-row">
                <Plus className="h-4 w-4" aria-hidden /> Add row
              </button>
              <button type="button" className="crm-btn crm-btn-outline-primary" onClick={() => setPicker(true)} disabled={!p.products.length} data-testid="add-multiple">
                <Plus className="h-4 w-4" aria-hidden /> Add multiple products
              </button>
              <span className="hidden text-xs text-text-muted md:inline">Ctrl+Enter adds a row · paste rows from Excel (product or code, quantity, price)</span>
            </>
          )}
        </div>
        <div className="w-full md:w-96 md:shrink-0">
          {lines.length > 8 ? (
            <button type="button" className="mb-1 text-xs text-primary underline" onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth" })}>
              ↑ Go to top of the list
            </button>
          ) : null}
          <dl className="crm-grid-totals" data-testid="grid-totals">
            <div>
              <dt>Sub Total({sym})</dt>
              <dd data-testid="sub-total">{fmt(calc.subTotal)}</dd>
            </div>
            <div className="relative">
              <dt>Discount({sym})</dt>
              <dd>
                <button type="button" className="crm-grid-readonly crm-grid-clickable w-full" disabled={ro} onClick={() => setDocPopup("discount")} aria-label={`Document discount ${fmt(calc.documentDiscount)} – change`} data-testid="doc-discount">
                  {fmt(calc.documentDiscount)}
                </button>
              </dd>
              {docPopup === "discount" ? <DiscountEditor type={header.discountType} value={header.discountValue} base={calc.subTotal} symbol={sym} onChange={(t, v) => emit(lines, { ...header, discountType: t, discountValue: v })} onClose={() => setDocPopup(null)} /> : null}
            </div>
            <div className="relative">
              <dt>Tax({sym})</dt>
              <dd>
                {p.taxMode === "DOCUMENT" ? (
                  <button type="button" className="crm-grid-readonly crm-grid-clickable w-full" disabled={ro} onClick={() => setDocPopup("tax")} aria-label={`Document tax ${fmt(calc.documentTax)} – change`}>
                    {fmt(calc.documentTax)}
                  </button>
                ) : (
                  <span className="crm-grid-readonly w-full" title="Taxes are on the lines">
                    {fmt(calc.taxTotal)}
                  </span>
                )}
              </dd>
              {docPopup === "tax" ? <TaxEditor options={p.taxOptions} value={header.taxes} base={calc.subTotal - calc.documentDiscount} onChange={(t) => emit(lines, { ...header, taxes: t })} onClose={() => setDocPopup(null)} /> : null}
            </div>
            <div>
              <dt>
                <label htmlFor="grid-adjustment">Adjustment({sym})</label>
              </dt>
              <dd>
                <input id="grid-adjustment" className="crm-grid-input w-full text-right" type="number" step="0.01" value={header.adjustment} readOnly={ro || !p.canAdjust} title={!p.canAdjust && !ro ? "Only the brand's managers can enter an adjustment" : undefined} onChange={(e) => emit(lines, { ...header, adjustment: e.target.value })} />
              </dd>
            </div>
            <div className="crm-grid-grand">
              <dt>Grand Total({sym})</dt>
              <dd data-testid="grand-total">{fmt(calc.grandTotal)}</dd>
            </div>
          </dl>
          {calc.grandTotal > 0 && p.currency === "NGN" ? (
            <p className="mt-1 text-right text-xs text-text-muted" data-testid="amount-in-words">
              {amountInWords(calc.grandTotal)}
            </p>
          ) : null}
        </div>
      </div>
      {picker ? (
        <MultiPicker
          products={p.products}
          onClose={() => setPicker(false)}
          onAdd={(items) => {
            const room = MAX_GRID_LINES - lines.length + (empty ? 1 : 0);
            const added = items.slice(0, room).map(({ p: prod, qty }) => newLine(fromProduct(prod, qty)));
            emit([...(empty ? [] : lines), ...added]);
            setPicker(false);
            if (items.length > room) toast(`Only ${room} more line(s) fit – at most ${MAX_GRID_LINES}`, "error");
          }}
        />
      ) : null}
      {paste ? (
        <PastePreview
          rows={paste}
          onClose={() => setPaste(null)}
          onConfirm={() => {
            const added = paste.map((r) => newLine(r.product ? { ...fromProduct(r.product, r.qty), ...(r.price !== null ? { unitPrice: String(r.price) } : {}) } : { description: r.name, qty: String(r.qty), unitPrice: r.price !== null ? String(r.price) : "", taxes: defaultTaxes }));
            emit([...(empty ? [] : lines), ...added].slice(0, MAX_GRID_LINES));
            setPaste(null);
          }}
        />
      ) : null}
    </section>
  );
}

