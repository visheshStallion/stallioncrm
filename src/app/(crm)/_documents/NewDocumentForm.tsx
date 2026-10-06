"use client";

import { ChevronDown, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { LineItemsGrid, gridPayload, newLine, type GridValue } from "@/components/crm/LineItemsGrid";
import type { GridProduct } from "@/server/modules/documents/lookups";

interface InitLine {
  productId?: string;
  description: string;
  qty?: string;
  unitPrice?: string;
  discountPct?: string;
  isStockItem?: boolean;
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
  initial?: { templateId?: string | null; templateName?: string | null; brandId?: string | null; lines?: InitLine[]; terms?: string | null; notes?: string | null; headerDiscountPct?: number | null; links?: Partial<Record<"dealId" | "accountId" | "contactId" | "sourceDocumentId", { id: string; label: string }>>; billTo?: Partial<Party> };
  showVin: boolean;
}

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
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [canSaveProduct, setCanSaveProduct] = useState(false);
  const [settings, setSettings] = useState<{ taxes: Array<{ name: string; rate: number }>; taxMode: "LINE" | "DOCUMENT"; requireProduct: boolean; canAdjust: boolean }>({ taxes: [{ name: "VAT", rate: 7.5 }], taxMode: "LINE", requireProduct: false, canAdjust: true });
  const [grid, setGrid] = useState<GridValue>(() => ({
    lines: init.lines?.length ? init.lines.map((l) => newLine({ productId: l.productId ?? "", description: l.description, qty: l.qty ?? "1", unitPrice: l.unitPrice ?? "", discountValue: l.discountPct ?? "0", isStockItem: !!l.isStockItem }, [{ name: "VAT", rate: 7.5 }])) : [newLine({}, [{ name: "VAT", rate: 7.5 }])],
    header: { discountType: "PERCENT", discountValue: String(init.headerDiscountPct ?? 0), taxes: [], adjustment: "0" },
  }));
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
        setSettings(res.data.grid);
        // template lines without a typed price take the price-book price of their product
        setGrid((g) => ({ ...g, lines: g.lines.map((l) => (l.productId && !l.unitPrice ? { ...l, unitPrice: String(res.data.products.find((x) => x.id === l.productId)?.price ?? "") } : l)) }));
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

  const saveAsProduct = (key: string) =>
    start(async () => {
      const l = grid.lines.find((x) => x.key === key);
      if (!l) return;
      const res = await saveLineAsProductAction(brandId, { name: l.description, price: Number(l.unitPrice) || 0, vehicle: l.isStockItem });
      if (!res.ok) return toast(res.error.message, "error");
      setProducts((ps) => [...ps, { id: res.data.id, name: res.data.name, code: "", category: l.isStockItem ? "VEHICLE" : "ACCESSORY", price: res.data.price, taxRatePct: l.taxes[0]?.rate ?? 7.5, maxDiscountPct: null, vehicle: l.isStockItem, uom: null, stock: null }]);
      setGrid((g) => ({ ...g, lines: g.lines.map((x) => (x.key === key ? { ...x, productId: res.data.id } : x)) }));
      toast(`“${res.data.name}” is now a product of the brand`, "success");
    });

  const submit = () =>
    start(async () => {
      const payload = {
        brandId,
        regionId,
        billTo: Object.fromEntries(Object.entries(party).filter(([, v]) => v.trim() !== "")),
        ...gridPayload(grid),
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

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="new-lines">
        <LineItemsGrid
          documentType={p.type}
          value={grid}
          onChange={setGrid}
          products={products}
          taxOptions={settings.taxes}
          taxMode={settings.taxMode}
          currency="NGN"
          brandId={brandId}
          canAdjust={settings.canAdjust}
          showVins={p.showVin}
          requireProduct={settings.requireProduct}
        />
        {canSaveProduct && grid.lines.some((l) => !l.productId && l.description.trim()) ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted" data-testid="save-as-product">
            Free-text items:
            {grid.lines
              .filter((l) => !l.productId && l.description.trim())
              .map((l) => (
                <button key={l.key} type="button" className="text-primary underline" disabled={pending} onClick={() => saveAsProduct(l.key)}>
                  Save “{l.description}” as product
                </button>
              ))}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-[13px]">
            Terms &amp; conditions <span className="text-xs text-text-muted">(empty: the brand’s standard terms)</span>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="mt-1 h-16 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block text-[13px]">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 h-16 w-full rounded-md border border-border bg-background p-2" />
          </label>
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
