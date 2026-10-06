"use client";

import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  brandProductsAction,
  createDocumentAction,
  customerByPhoneAction,
  linkTargetsAction,
  saveLineAsProductAction,
  searchCustomersAction,
} from "@/server/modules/documents/actions";
import type { CustomerHit } from "@/server/modules/documents/lookups";
import { computeTotals } from "@/server/modules/documents/totals";

interface Product {
  id: string;
  name: string;
  price: number | null;
  taxRatePct: number;
  maxDiscountPct: number | null;
  vehicle: boolean;
}
interface Row {
  key: string;
  productId: string;
  description: string;
  itemCode: string;
  uom: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
  vin: string;
  isStockItem: boolean;
}
type Party = { name: string; company: string; phone: string; email: string; address: string; city: string; state: string; taxId: string };
const EMPTY_PARTY: Party = { name: "", company: "", phone: "", email: "", address: "", city: "", state: "", taxId: "" };

export interface NewDocumentProps {
  type: "quote" | "salesOrder" | "invoice";
  label: string;
  path: string;
  dateLabel: string;
  brands: Array<{ id: string; code: string; name: string }>;
  regions: Array<{ id: string; name: string }>;
  defaultBrandId: string | null;
  defaultRegionId: string | null;
  /** prefill: a record template, or a link from another page (?dealId, ?accountId …) */
  initial?: { templateId?: string | null; templateName?: string | null; brandId?: string | null; lines?: Array<Partial<Row> & { description: string }>; terms?: string | null; notes?: string | null; headerDiscountPct?: number | null; links?: Partial<Record<"dealId" | "accountId" | "contactId" | "sourceDocumentId", { id: string; label: string }>>; billTo?: Partial<Party> };
  showVin: boolean;
}

let seq = 0;
const n = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? 0 : Number(s));
const fmt = (v: number) => v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = (patch: Partial<Row> = {}): Row => ({ key: `r${++seq}`, productId: "", description: "", itemCode: "", uom: "", qty: "1", unitPrice: "", discountPct: "0", taxRate: "7.5", vin: "", isStockItem: false, ...patch });
const label = "block space-y-1 text-xs font-medium text-text-muted";

/** A search box over records of the same brand (deals, quotes, sales orders) for the optional links. */
function LinkPicker({ brandId, kind, value, onChange, name }: { brandId: string; kind: "deal" | "quote" | "salesOrder"; value: { id: string; label: string } | null; onChange: (v: { id: string; label: string; regionId?: string } | null) => void; name: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; label: string; regionId: string }>>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !brandId) return;
    const t = window.setTimeout(async () => {
      const res = await linkTargetsAction(brandId, kind, q);
      if (res.ok) setHits(res.data);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, brandId, kind]);
  if (value)
    return (
      <div className="flex items-center gap-2 text-sm" data-testid={`link-${kind}`}>
        <span className="truncate">{value.label}</span>
        <button type="button" className="text-xs text-primary underline" onClick={() => onChange(null)}>
          Remove
        </button>
      </div>
    );
  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} placeholder={`Search ${name.toLowerCase()} of this brand`} aria-label={`Link a ${name.toLowerCase()}`} disabled={!brandId} />
      {open && hits.length ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg" role="listbox" aria-label={`${name} results`}>
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" role="option" aria-selected={false} className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => (onChange(h), setOpen(false), setQ(""))}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Standalone quote / sales order / invoice (prompt 23): brand and region (pre-filled), the customer typed inline or
 * picked from existing customers, line items with a product or free text, optional links. Totals shown here use the
 * same function as the server, which recomputes everything – nothing calculated here is trusted.
 */
export function NewDocumentForm(p: NewDocumentProps) {
  const router = useRouter();
  const init = p.initial ?? {};
  const [brandId, setBrandId] = useState(init.brandId ?? p.defaultBrandId ?? (p.brands.length === 1 ? p.brands[0]!.id : ""));
  const [regionId, setRegionId] = useState(p.defaultRegionId ?? "");
  const [party, setParty] = useState<Party>({ ...EMPTY_PARTY, ...Object.fromEntries(Object.entries(init.billTo ?? {}).map(([k, v]) => [k, v ?? ""])) });
  const [customer, setCustomer] = useState<{ accountId: string | null; contactId: string | null; label: string } | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [dupe, setDupe] = useState<CustomerHit | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [canSaveProduct, setCanSaveProduct] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => (init.lines?.length ? init.lines.map((l) => blank({ ...l, qty: String(l.qty ?? "1"), unitPrice: l.unitPrice ?? "" })) : [blank()]));
  const [headerDiscount, setHeaderDiscount] = useState(String(init.headerDiscountPct ?? 0));
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState("");
  const [terms, setTerms] = useState(init.terms ?? "");
  const [notes, setNotes] = useState(init.notes ?? "");
  const [deal, setDeal] = useState<{ id: string; label: string } | null>(init.links?.dealId ?? null);
  const [source, setSource] = useState<{ id: string; label: string } | null>(init.links?.sourceDocumentId ?? null);
  const [linksOpen, setLinksOpen] = useState(!!(init.links && Object.keys(init.links).length));
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLDivElement>(null);

  // the brand's products (with today's price-book price) whenever the brand changes
  useEffect(() => {
    if (!brandId) return setProducts([]);
    void brandProductsAction(brandId).then((res) => {
      if (res.ok) {
        setProducts(res.data.products);
        setCanSaveProduct(res.data.canSaveAsProduct);
      }
    });
  }, [brandId]);
  // customer search: name or phone of customers the user can see
  useEffect(() => {
    if (search.trim().length < 2) return setHits([]);
    const t = window.setTimeout(async () => {
      const res = await searchCustomersAction(search);
      if (res.ok) setHits(res.data);
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);
  // non-blocking duplicate hint when a phone is typed for a new customer
  useEffect(() => {
    if (customer || party.phone.replace(/\D/g, "").length < 7) return setDupe(null);
    const t = window.setTimeout(async () => {
      const res = await customerByPhoneAction(party.phone);
      setDupe(res.ok ? res.data : null);
    }, 400);
    return () => window.clearTimeout(t);
  }, [party.phone, customer]);

  const pick = (h: CustomerHit) => {
    // fills empty fields only – what was typed stays
    setParty((cur) => {
      const next = { ...cur };
      const from: Partial<Party> = { name: h.name, company: h.company ?? "", phone: h.phone ?? "", email: h.email ?? "", address: h.address ?? "", city: h.city ?? "", state: h.state ?? "" };
      for (const [k, v] of Object.entries(from)) if (v && !next[k as keyof Party]) next[k as keyof Party] = v;
      return next;
    });
    setCustomer({ accountId: h.accountId, contactId: h.contactId, label: h.company ? `${h.name} (${h.company})` : h.name });
    setSearch("");
    setHits([]);
    setDupe(null);
  };

  const totals = useMemo(() => computeTotals(rows.map((r) => ({ qty: n(r.qty), unitPrice: n(r.unitPrice), discountPct: n(r.discountPct), taxRate: n(r.taxRate) })), n(headerDiscount)), [rows, headerDiscount]);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const saveAsProduct = (r: Row) =>
    start(async () => {
      const res = await saveLineAsProductAction(brandId, { name: r.description, price: n(r.unitPrice), vehicle: r.isStockItem });
      if (!res.ok) return toast(res.error.message, "error");
      setProducts((ps) => [...ps, { id: res.data.id, name: res.data.name, price: res.data.price, taxRatePct: n(r.taxRate), maxDiscountPct: null, vehicle: r.isStockItem }]);
      set(r.key, { productId: res.data.id });
      toast(`“${res.data.name}” is now a product of the brand`, "success");
    });

  const submit = () =>
    start(async () => {
      const payload = {
        brandId,
        regionId,
        billTo: Object.fromEntries(Object.entries(party).filter(([, v]) => v.trim() !== "")),
        lines: rows.filter((r) => r.description.trim() || r.productId).map((r) => ({ productId: r.productId, description: r.description, itemCode: r.itemCode, uom: r.uom, qty: r.qty, unitPrice: r.unitPrice, discountPct: r.discountPct, taxRate: r.taxRate, vin: r.vin, isStockItem: r.isStockItem })),
        headerDiscountPct: headerDiscount,
        issueDate,
        date,
        terms,
        notes,
        dealId: deal?.id ?? null,
        accountId: customer?.accountId ?? null,
        contactId: customer?.contactId ?? null,
        sourceDocumentId: source?.id ?? null,
      };
      const res = await createDocumentAction(p.type, payload, init.templateId ?? null);
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message, "success");
      router.push(res.data.redirect);
    });

  const brand = p.brands.find((b) => b.id === brandId);
  const sourceKind = p.type === "salesOrder" ? "quote" : "salesOrder";

  return (
    <div className="space-y-4" data-testid="new-document">
      {init.templateName ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm" data-testid="template-banner">
          From the template <strong>{init.templateName}</strong> – line items are priced from today’s price book.
        </p>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-4">
        <label className={label}>
          <span>Brand *</span>
          <select className="crm-select w-full" value={brandId} onChange={(e) => (setBrandId(e.target.value), setDeal(null), setSource(null))} aria-label="Brand" disabled={!!init.templateId && !!init.brandId}>
            <option value="">Choose…</option>
            {p.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} – {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Region *</span>
          <select className="crm-select w-full" value={regionId} onChange={(e) => setRegionId(e.target.value)} aria-label="Region">
            <option value="">Choose…</option>
            {p.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>{p.type === "invoice" ? "Invoice date *" : "Issue date"}</span>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} aria-label={p.type === "invoice" ? "Invoice date" : "Issue date"} required={p.type === "invoice"} />
        </label>
        <label className={label}>
          <span>{p.dateLabel}</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={p.dateLabel} />
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="bill-to">
        <h2 className="text-[13px] font-semibold">Bill to</h2>
        {customer ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="bill-to-linked">
            Linked customer: <strong>{customer.label}</strong>
            <button type="button" className="text-xs text-primary underline" onClick={() => setCustomer(null)}>
              Do not link
            </button>
          </p>
        ) : (
          <div ref={searchRef} className="relative max-w-xl" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHits([])}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Find an existing customer by name or phone – or just type the new customer below" aria-label="Find a customer" />
            {hits.length ? (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg" role="listbox" aria-label="Customers">
                {hits.map((h) => (
                  <li key={`${h.kind}:${h.id}`}>
                    <button type="button" role="option" aria-selected={false} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => pick(h)}>
                      <span className="font-medium">{h.name}</span>
                      {h.company ? <span className="text-text-muted"> · {h.company}</span> : null}
                      {h.phone ? <span className="text-text-muted"> · {h.phone}</span> : null}
                      <span className="ml-1 text-xs text-text-muted">({h.kind})</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-4">
          {(
            [
              ["name", "Customer name *"],
              ["company", "Company"],
              ["phone", "Phone"],
              ["email", "E-mail"],
              ["address", "Address"],
              ["city", "City"],
              ["state", "State"],
              ["taxId", "TIN / VAT no."],
            ] as Array<[keyof Party, string]>
          ).map(([k, l]) => (
            <label key={k} className={label}>
              <span>{l}</span>
              <Input value={party[k]} onChange={(e) => setParty({ ...party, [k]: e.target.value })} aria-label={l.replace(" *", "")} required={k === "name"} />
            </label>
          ))}
        </div>
        {dupe ? (
          <p className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="duplicate-hint">
            A customer with this phone exists: <strong>{dupe.name}</strong>
            <button type="button" className="text-xs font-semibold text-primary underline" onClick={() => pick(dupe)}>
              Link it
            </button>
            <button type="button" className="text-xs text-text-muted underline" onClick={() => setDupe(null)}>
              No, a new customer
            </button>
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-surface p-4" data-testid="new-lines">
        <h2 className="text-[13px] font-semibold">Line items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="w-48 py-1">Product</th>
                <th>Item / description *</th>
                <th className="w-16">UOM</th>
                <th className="w-16 text-right">Qty</th>
                <th className="w-32 text-right">Unit price</th>
                <th className="w-16 text-right">Disc %</th>
                <th className="w-16 text-right">VAT %</th>
                {p.showVin ? <th className="w-36">VIN</th> : null}
                <th className="w-32 text-right">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-t border-border align-top" data-testid="new-line">
                  <td className="py-1 pr-1">
                    <select
                      className="crm-select h-8 w-full"
                      value={r.productId}
                      aria-label={`Product line ${i + 1}`}
                      onChange={(e) => {
                        const pr = products.find((x) => x.id === e.target.value);
                        set(r.key, pr ? { productId: pr.id, description: r.description || pr.name, unitPrice: pr.price === null ? r.unitPrice : String(pr.price), taxRate: String(pr.taxRatePct), isStockItem: pr.vehicle } : { productId: "" });
                      }}
                    >
                      <option value="">— free text —</option>
                      {products.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pr-1">
                    <Input value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} className="h-8" aria-label={`Item line ${i + 1}`} />
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={r.isStockItem} onChange={(e) => set(r.key, { isStockItem: e.target.checked })} /> Vehicle / stock item
                      </label>
                      {!r.productId && canSaveProduct && r.description.trim() ? (
                        <button type="button" className="text-primary underline" onClick={() => saveAsProduct(r)} disabled={pending}>
                          Save as product
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="pr-1">
                    <Input value={r.uom} onChange={(e) => set(r.key, { uom: e.target.value })} className="h-8" aria-label={`Unit of measure line ${i + 1}`} />
                  </td>
                  <td className="pr-1">
                    <Input value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} type="number" min={0} className="h-8 text-right" aria-label={`Quantity line ${i + 1}`} />
                  </td>
                  <td className="pr-1">
                    <Input value={r.unitPrice} onChange={(e) => set(r.key, { unitPrice: e.target.value })} type="number" min={0} step="0.01" className="h-8 text-right" aria-label={`Unit price line ${i + 1}`} placeholder={r.productId ? "price book" : ""} />
                  </td>
                  <td className="pr-1">
                    <Input value={r.discountPct} onChange={(e) => set(r.key, { discountPct: e.target.value })} type="number" min={0} max={100} className="h-8 text-right" aria-label={`Discount % line ${i + 1}`} />
                  </td>
                  <td className="pr-1">
                    <Input value={r.taxRate} onChange={(e) => set(r.key, { taxRate: e.target.value })} type="number" min={0} max={100} className="h-8 text-right" aria-label={`VAT % line ${i + 1}`} />
                  </td>
                  {p.showVin ? (
                    <td className="pr-1">
                      <Input value={r.vin} onChange={(e) => set(r.key, { vin: e.target.value.toUpperCase(), isStockItem: r.isStockItem || !!e.target.value })} className="h-8 uppercase" aria-label={`VIN line ${i + 1}`} />
                    </td>
                  ) : null}
                  <td className="py-2 text-right tabular-nums">{fmt(totals.lineTotals[i] ?? 0)}</td>
                  <td>
                    <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} aria-label={`Remove line ${i + 1}`} className="p-1.5 text-text-muted hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, blank()])}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
        <div className="grid gap-4 pt-2 md:grid-cols-2">
          <div className="space-y-2 text-[13px]">
            <label className="block">
              Terms &amp; conditions <span className="text-xs text-text-muted">(empty: the brand’s standard terms)</span>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="mt-1 h-16 w-full rounded-md border border-border bg-background p-2" />
            </label>
            <label className="block">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 h-12 w-full rounded-md border border-border bg-background p-2" />
            </label>
          </div>
          <div className="space-y-1 text-[13px]" data-testid="new-totals">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2">
                Header discount %
                <Input value={headerDiscount} onChange={(e) => setHeaderDiscount(e.target.value)} type="number" min={0} max={100} className="h-8 w-20 text-right" aria-label="Header discount %" />
              </label>
              <span className="tabular-nums">− {fmt(totals.discountTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT</span>
              <span className="tabular-nums">{fmt(totals.taxTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold">
              <span>Total</span>
              <span className="tabular-nums" data-testid="new-total">
                {fmt(totals.total)}
              </span>
            </div>
            <p className="text-xs text-text-muted">Product lines without a price take the price book’s price. The server calculates the final totals.</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface" data-testid="optional-links">
        <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-semibold" aria-expanded={linksOpen} onClick={() => setLinksOpen((o) => !o)}>
          Optional links {brand ? <span className="font-normal text-text-muted">– records of {brand.code} only</span> : null}
          <ChevronDown className={`h-4 w-4 transition-transform ${linksOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {linksOpen ? (
          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
            <div className={label}>
              <span>Deal</span>
              <LinkPicker brandId={brandId} kind="deal" name="Deal" value={deal} onChange={(v) => (setDeal(v), v?.regionId && setRegionId(v.regionId))} />
            </div>
            {p.type !== "quote" ? (
              <div className={label}>
                <span>{p.type === "salesOrder" ? "Quote" : "Quote or sales order"}</span>
                <LinkPicker brandId={brandId} kind={sourceKind} name={p.type === "salesOrder" ? "Quote" : "Sales order"} value={source} onChange={setSource} />
              </div>
            ) : null}
            <p className="text-xs text-text-muted md:col-span-2">Account and contact: pick the customer above. Links can also be added later on the document (⋯ → Link to…).</p>
          </div>
        ) : null}
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push(p.path)}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={pending} data-testid="new-document-save">
          {pending ? "Saving…" : `Save ${p.label.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
