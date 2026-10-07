"use client";

import { FileText, Handshake, Lock, User, UserSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AddressBlock, DateInput, Field, Lookup, Money, type Address, type DateFormat } from "@/components/crm/form-kit";
import { LineItemsGrid, gridPayload, newLine, type GridValue } from "@/components/crm/LineItemsGrid";
import { toast } from "@/components/Toaster";
import { COUNTRIES } from "@/lib/countries";
import { brandProductsAction } from "@/server/modules/documents/actions";
import { calcDocument } from "@/server/modules/documents/calc";
import { accountLinksAction } from "@/server/modules/documents/invoice-actions";
import type { GridProduct } from "@/server/modules/documents/lookups";
import { orderFormDataAction, quoteForOrderAction, saveOrderPageAction } from "@/server/modules/documents/so-actions";
import type { OrderFormData } from "@/server/modules/documents/so-page";
import { AccountField, type Hit } from "../invoices/InvoiceForm";

const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;
const STATUS_LABELS: Record<string, string> = { DRAFT: "Created", CONFIRMED: "Confirmed", ALLOCATED: "Allocated", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
const money = (n: number) => n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface OrderValues {
  ownerId: string;
  subject: string;
  customerNo: string;
  quoteId: string;
  pending: string;
  carrier: string;
  salesCommission: string;
  accountId: string;
  customerName: string;
  otherCharges: string;
  exchangeRate: string;
  dealId: string;
  customerPoRef: string;
  dueDate: string;
  contactId: string;
  exciseDuty: string;
  currency: string;
  phone: string;
  tinNumber: string;
  billTo: Address;
  shipTo: Address;
  terms: string;
  description: string;
}

export interface SalesOrderFormProps {
  mode: "create" | "edit" | "clone";
  id?: string;
  number?: string;
  status?: string;
  brands: Array<{ id: string; code: string; name: string }>;
  brandId: string;
  data: OrderFormData | null;
  initial?: Partial<OrderValues>;
  initialGrid?: GridValue;
  labels?: { deal?: { id: string; name: string } | null; contact?: { id: string; name: string } | null; quote?: { id: string; label: string } | null };
  dateFormat: DateFormat;
  designBrands: string[];
  userId: string;
  templateName?: string | null;
}

const EMPTY: OrderValues = { ownerId: "", subject: "", customerNo: "", quoteId: "", pending: "", carrier: "", salesCommission: "", accountId: "", customerName: "", otherCharges: "", exchangeRate: "1", dealId: "", customerPoRef: "", dueDate: "", contactId: "", exciseDuty: "", currency: "NGN", phone: "", tinNumber: "", billTo: { country: "Nigeria" }, shipTo: { country: "Nigeria" }, terms: "", description: "" };

/**
 * Create / Edit / Clone Sales Order (Zoho-style page): Sales Order Information, Address Information with Copy
 * Address, Ordered Items with Other Charges / Excise rows, Terms and Conditions, Description. The server re-checks
 * and recomputes everything.
 */
export function SalesOrderForm(p: SalesOrderFormProps) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(p.brandId);
  const [data, setData] = useState<OrderFormData | null>(p.data);
  const [v, setV] = useState<OrderValues>(() => {
    const start = { ...EMPTY, ...p.initial };
    if (p.mode === "create" && p.data) {
      if (!start.terms) start.terms = p.data.settings.terms;
      if (!start.carrier && p.data.settings.carriers.includes("FedEx")) start.carrier = "FedEx";
    }
    if (!start.ownerId && p.data?.owners.some((o) => o.id === p.userId)) start.ownerId = p.userId;
    return start;
  });
  const [grid, setGrid] = useState<GridValue>(() => p.initialGrid ?? { lines: [newLine({ key: "init0" }, [{ name: "VAT", rate: 7.5 }])], header: { discountType: "PERCENT", discountValue: "0", taxes: [], adjustment: "0" } });
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; phone: string | null; address: string | null; city: string | null }>>(p.labels?.contact ? [{ ...p.labels.contact, phone: null, address: null, city: null }] : []);
  const [account, setAccount] = useState<Hit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const upd = useCallback((patch: Partial<OrderValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!brandId) return setData(null);
    if (first.current && p.data?.brand.id === brandId) return;
    void orderFormDataAction(brandId).then((res) => {
      if (!res.ok) return toast(res.error.message, "error");
      setData(res.data);
      if (p.mode !== "edit")
        setV((cur) => ({
          ...cur,
          ownerId: res.data.owners.some((o) => o.id === cur.ownerId) ? cur.ownerId : res.data.owners.some((o) => o.id === p.userId) ? p.userId : "",
          terms: cur.terms || res.data.settings.terms,
          carrier: res.data.settings.carriers.includes(cur.carrier) ? cur.carrier : res.data.settings.carriers.includes("FedEx") ? "FedEx" : "",
          quoteId: "",
          dealId: "",
        }));
    });
  }, [brandId, p.data, p.mode, p.userId]);
  useEffect(() => {
    if (!brandId) return setProducts([]);
    void brandProductsAction(brandId).then((res) => res.ok && setProducts(res.data.products));
  }, [brandId]);
  useEffect(() => {
    if (!brandId || !v.accountId) return;
    void accountLinksAction(brandId, v.accountId).then((res) => res.ok && setContacts(res.data.contacts));
  }, [brandId, v.accountId]);
  useEffect(() => {
    first.current = false;
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cancelHref = p.id ? `/salesOrders/${p.id}` : "/salesOrders";
  const cancel = () => {
    if (dirty && !window.confirm("Discard the changes to this sales order?")) return;
    setDirty(false);
    router.push(cancelHref);
  };
  const rateLocked = v.currency === "NGN" || !data?.canEditRate;
  const otherInTotal = data?.settings.otherChargesEnabled ?? true;
  const exciseInTotal = data?.settings.exciseInTotal ?? false;
  const deals = (data?.deals ?? []).filter((d) => !v.accountId || !d.accountId || d.accountId === v.accountId);
  const dealOptions = [...deals.map((d) => ({ id: d.id, label: d.name })), ...(p.labels?.deal && !deals.some((d) => d.id === p.labels!.deal!.id) ? [{ id: p.labels.deal.id, label: p.labels.deal.name }] : [])];
  const quoteOptions = [...(data?.quotes ?? []).map((q) => ({ id: q.id, label: q.label, sub: q.customer })), ...(p.labels?.quote && !(data?.quotes ?? []).some((q) => q.id === p.labels!.quote!.id) ? [{ id: p.labels.quote.id, label: p.labels.quote.label }] : [])];
  const contact = contacts.find((c) => c.id === v.contactId) ?? null;

  const pickAccount = (a: Hit) => {
    setAccount(a);
    upd({ accountId: a.id, customerName: a.name, contactId: "", dealId: "", tinNumber: v.tinNumber || a.taxId || "", phone: v.phone || a.phone || "", billTo: { street: a.address ?? "", city: a.city ?? "", state: a.state ?? "", country: "Nigeria" } });
  };
  const pickQuote = (quoteId: string) => {
    if (!quoteId) return upd({ quoteId: "" });
    const label = data?.quotes.find((q) => q.id === quoteId)?.number ?? "the quote";
    if (!window.confirm(`Copy details and items from ${label}?`)) return upd({ quoteId });
    start(async () => {
      const res = await quoteForOrderAction(quoteId);
      if (!res.ok) return toast(res.error.message, "error");
      const q = res.data;
      if (q.contact) setContacts((l) => (l.some((c) => c.id === q.contact!.id) ? l : [...l, { ...q.contact!, phone: null, address: null, city: null }]));
      upd({
        quoteId,
        subject: v.subject || q.subject || `${q.number} – ${q.customerName}`,
        accountId: q.account?.id ?? "",
        customerName: q.customerName,
        contactId: q.contact?.id ?? "",
        dealId: q.dealId ?? "",
        phone: q.phone ?? "",
        tinNumber: q.tinNumber ?? "",
        currency: q.currency,
        exchangeRate: q.currency === "NGN" ? "1" : String(data?.rates[q.currency] ?? ""),
        terms: q.terms || v.terms,
        billTo: q.billTo,
        shipTo: { ...q.billTo },
      });
      setGrid({
        lines: q.lines.map((l, i) => newLine({ key: `q${i}`, productId: l.productId ?? "", description: l.description, details: l.details ?? "", itemCode: l.itemCode ?? "", uom: l.uom ?? "", qty: String(l.qty), unitPrice: String(l.unitPrice), discountType: l.discountType, discountValue: String(l.discountValue), taxes: l.taxes.map(({ name, rate }) => ({ name, rate })), vins: l.vins, isStockItem: l.isStockItem })),
        header: { discountType: q.headerDiscountType, discountValue: String(q.headerDiscountValue), taxes: q.documentTaxes, adjustment: "0" },
      });
      toast(`Copied from ${q.number}`, "success");
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!brandId) e.brand = "Choose the brand";
    if (!v.subject.trim()) e.subject = "Enter the subject";
    if (!v.customerName.trim()) e.account = "Pick an account or type the customer's name";
    else if (data?.settings.requireAccount && !v.accountId) e.account = "This brand needs a linked account – pick one";
    if (data?.settings.requireQuoteBeforeOrder && !v.quoteId) e.quote = "This brand creates sales orders from quotes – choose the quote";
    if (!grid.lines.some((l) => (l.description.trim() || l.productId) && Number(l.qty) > 0)) e.items = "Add at least one ordered item with a quantity";
    if (v.currency !== "NGN" && !(Number(v.exchangeRate) > 0)) e.exchangeRate = "No exchange rate for this currency";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const save = (mode: "save" | "new") => {
    if (pending) return;
    if (!validate()) return toast("Check the highlighted fields", "error");
    start(async () => {
      const payload = { brandId, ...v, ownerId: v.ownerId || undefined, accountId: v.accountId || undefined, contactId: v.contactId || undefined, dealId: v.dealId || undefined, quoteId: v.quoteId || undefined, ...gridPayload(grid) };
      const res = await saveOrderPageAction(p.mode === "edit" ? p.id! : null, payload, mode);
      if (!res.ok) return toast(res.error.message, "error");
      setDirty(false);
      toast(res.data.message, "success");
      router.push(res.data.redirect);
      if (mode === "new") router.refresh();
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ngnTotal = useMemo(() => {
    const n = (s: string) => Number(s) || 0;
    const r = calcDocument(
      grid.lines.map((l) => ({ qty: n(l.qty), unitPrice: n(l.unitPrice), discountType: l.discountType, discountValue: n(l.discountValue), taxes: l.taxes })),
      { discountType: grid.header.discountType, discountValue: n(grid.header.discountValue), taxes: grid.header.taxes, adjustment: n(grid.header.adjustment), taxMode: data?.grid.taxMode ?? "LINE" },
    );
    return (r.grandTotal + (otherInTotal ? n(v.otherCharges) : 0) + (exciseInTotal ? n(v.exciseDuty) : 0)) * (n(v.exchangeRate) || 0);
  }, [grid, data, v.otherCharges, v.exciseDuty, v.exchangeRate, otherInTotal, exciseInTotal]);

  const copy = (what: "b2s" | "s2b" | "account" | "contact") => {
    setCopyOpen(false);
    if (what === "b2s") upd({ shipTo: { ...v.billTo } });
    else if (what === "s2b") upd({ billTo: { ...v.shipTo } });
    else if (what === "account") {
      if (!account) return toast("Pick an account first", "error");
      upd({ billTo: { street: account.address ?? "", city: account.city ?? "", state: account.state ?? "", country: "Nigeria" } });
    } else {
      if (!contact) return toast("Choose the contact first", "error");
      upd({ billTo: { ...v.billTo, street: contact.address ?? v.billTo.street, city: contact.city ?? v.billTo.city } });
    }
  };

  const canDesign = p.designBrands.includes(brandId);
  const title = p.mode === "edit" ? `Edit Sales Order${p.number ? ` ${p.number}` : ""}` : p.mode === "clone" ? "Clone Sales Order" : "Create Sales Order";
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null);
  const blank = <div className="hidden lg:block" aria-hidden />;
  const n = (s: string) => Number(s) || 0;

  return (
    <div data-testid="order-form">
      <datalist id="po-countries">
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>{title}</h1>
          {canDesign ? (
            <Link href="/setup/invoice-settings" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="crm-btn crm-btn-secondary" onClick={cancel} data-testid="so-cancel">
            Cancel
          </button>
          {p.mode !== "edit" ? (
            <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={() => save("new")} data-testid="so-save-new">
              Save and New
            </button>
          ) : null}
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={() => save("save")} data-testid="so-save">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {p.templateName ? <p className="mb-3 text-[13px] text-text-muted">From the template “{p.templateName}”</p> : null}

      <div className="crm-po-card">
        <section className="crm-po-section" aria-labelledby="so-info">
          <h2 id="so-info" className="crm-po-section-title">
            Sales Order Information
          </h2>
          <div className="crm-po-fields">
            <Field label="Sales Order Owner" htmlFor="so-owner">
              <Lookup id="so-owner" label="Sales Order Owner" value={v.ownerId} options={(data?.owners ?? []).map((o) => ({ id: o.id, label: o.name }))} onChange={(id) => upd({ ownerId: id })} icon={<UserSearch className="h-4 w-4" aria-hidden />} required testId="so-owner" />
            </Field>
            <Field label="Deal Name" htmlFor="so-deal">
              <Lookup id="so-deal" label="Deal Name" value={v.dealId} options={dealOptions} onChange={(id) => upd({ dealId: id })} icon={<Handshake className="h-4 w-4" aria-hidden />} disabled={!brandId} testId="so-deal" />
            </Field>
            <Field label="Subject" htmlFor="so-subject">
              <input id="so-subject" className="crm-po-input crm-po-req" value={v.subject} onChange={(e) => upd({ subject: e.target.value })} maxLength={255} aria-required aria-invalid={!!errors.subject || undefined} />
              {err("subject")}
            </Field>
            <Field label="Purchase Order" htmlFor="so-po-ref">
              <input id="so-po-ref" className="crm-po-input" value={v.customerPoRef} onChange={(e) => upd({ customerPoRef: e.target.value })} maxLength={80} placeholder="The customer's PO reference" />
            </Field>
            <Field label="Customer No." htmlFor="so-customer-no">
              <input id="so-customer-no" className="crm-po-input" value={v.customerNo} onChange={(e) => upd({ customerNo: e.target.value })} maxLength={60} />
            </Field>
            <Field label="Due Date" htmlFor="so-due">
              <DateInput id="so-due" label="Due Date" value={v.dueDate} onChange={(iso) => upd({ dueDate: iso })} format={p.dateFormat} />
            </Field>
            <Field label="Quote Name" htmlFor="so-quote">
              <Lookup id="so-quote" label="Quote Name" value={v.quoteId} options={quoteOptions} onChange={pickQuote} icon={<FileText className="h-4 w-4" aria-hidden />} disabled={!brandId || p.mode === "edit"} placeholder="Approved, sent or accepted quotes" testId="so-quote" />
              {err("quote")}
            </Field>
            <Field label="Contact Name" htmlFor="so-contact">
              <Lookup id="so-contact" label="Contact Name" value={v.contactId} options={contacts.map((c) => ({ id: c.id, label: c.name, sub: c.phone }))} onChange={(id) => upd({ contactId: id, phone: v.phone || contacts.find((c) => c.id === id)?.phone || "" })} icon={<User className="h-4 w-4" aria-hidden />} disabled={!v.accountId} placeholder={v.accountId ? "Search" : "Pick an account first"} testId="so-contact" />
            </Field>
            <Field label="Pending" htmlFor="so-pending">
              <input id="so-pending" className="crm-po-input" value={v.pending} onChange={(e) => upd({ pending: e.target.value })} maxLength={255} placeholder="What is still pending (documents, deposit …)" />
            </Field>
            <Field label="Excise Duty" htmlFor="so-excise">
              <Money id="so-excise" label="Excise Duty" value={v.exciseDuty} onChange={(x) => upd({ exciseDuty: x })} tip={exciseInTotal ? "Excise duty – added to the Grand Total (brand setting)" : "Excise duty – recorded and printed; the brand does not add it to the Grand Total"} />
            </Field>
            <Field label="Carrier" htmlFor="so-carrier">
              <select id="so-carrier" className="crm-po-input" value={v.carrier} onChange={(e) => upd({ carrier: e.target.value })}>
                <option value="">-None-</option>
                {(data?.settings.carriers ?? []).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor="so-status">
              <select id="so-status" className="crm-po-input" value={p.status ?? "DRAFT"} disabled title="The status changes with the buttons on the order (confirm, allocate, deliver)">
                {Object.entries(STATUS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sales Commission" htmlFor="so-commission">
              <Money id="so-commission" label="Sales Commission" value={v.salesCommission} onChange={(x) => upd({ salesCommission: x })} tip="Commission on this sale – used in commission reports, not added to the total" />
            </Field>
            <Field label="Currency" htmlFor="so-currency">
              <select id="so-currency" className="crm-po-input" value={v.currency} onChange={(e) => upd({ currency: e.target.value, exchangeRate: e.target.value === "NGN" ? "1" : String(data?.rates[e.target.value] ?? "") })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Account Name" htmlFor="inv-account">
              <AccountField value={v.customerName} label="Account Name" linked={!!v.accountId} invalid={!!errors.account} onType={(name) => (setAccount(null), upd({ customerName: name, accountId: "", contactId: "" }))} onPick={pickAccount} />
              {err("account")}
            </Field>
            <Field label="Brand / Company" htmlFor="so-brand">
              <select id="so-brand" className="crm-po-input crm-po-req" value={brandId} disabled={p.mode === "edit" || p.brands.length === 1} aria-required onChange={(e) => (setBrandId(e.target.value), setDirty(true))}>
                <option value="">-None-</option>
                {p.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} – {b.name}
                  </option>
                ))}
              </select>
              {err("brand")}
            </Field>
            {otherInTotal ? (
              <Field label="Add Other Charges" htmlFor="so-other">
                <Money id="so-other" label="Add Other Charges" value={v.otherCharges} onChange={(x) => upd({ otherCharges: x })} tip="Delivery, registration, plate number, documentation … – added to the Grand Total as “Other Charges”" />
              </Field>
            ) : (
              blank
            )}
            <Field label="Phone Number" htmlFor="so-phone">
              <input id="so-phone" type="tel" className="crm-po-input" value={v.phone} onChange={(e) => upd({ phone: e.target.value })} maxLength={40} placeholder="+234 …" />
            </Field>
            <Field label="Exchange Rate" htmlFor="so-rate">
              <div className="crm-po-addon">
                <input id="so-rate" type="number" min={0} step="0.000001" className="crm-po-input" value={v.exchangeRate} readOnly={rateLocked} onChange={(e) => upd({ exchangeRate: e.target.value })} />
                <span className="crm-po-iconbtn cursor-default" title={rateLocked ? (v.currency === "NGN" ? "Naira: always 1" : "From Setup → Currencies") : "You may change the rate"}>
                  <Lock className="h-4 w-4" aria-label={rateLocked ? "Locked" : "Editable"} />
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted" data-testid="so-ngn-total">
                {v.currency === "NGN" ? "₦ per ₦" : `₦ per 1 ${v.currency}`} · Grand Total ≈ ₦{money(ngnTotal)}
              </p>
              {err("exchangeRate")}
            </Field>
            <Field label="TIN Number" htmlFor="so-tin">
              <input id="so-tin" className="crm-po-input" value={v.tinNumber} onChange={(e) => upd({ tinNumber: e.target.value })} maxLength={20} placeholder="12345678-0001" />
            </Field>
          </div>
        </section>

        <section className="crm-po-section" aria-labelledby="so-address">
          <div className="crm-po-section-title">
            <h2 id="so-address">Address Information</h2>
            <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setCopyOpen(false)}>
              <button type="button" className="crm-btn crm-btn-secondary" aria-haspopup="menu" aria-expanded={copyOpen} onClick={() => setCopyOpen((o) => !o)} data-testid="copy-address">
                Copy Address
              </button>
              {copyOpen ? (
                <div className="crm-po-menu right-0 w-56" role="menu">
                  <button type="button" role="menuitem" onClick={() => copy("b2s")}>
                    Copy Billing to Shipping
                  </button>
                  <button type="button" role="menuitem" onClick={() => copy("s2b")}>
                    Copy Shipping to Billing
                  </button>
                  <button type="button" role="menuitem" onClick={() => copy("account")}>
                    From account
                  </button>
                  <button type="button" role="menuitem" onClick={() => copy("contact")}>
                    From contact
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="crm-po-fields">
            <AddressBlock prefix="Billing" value={v.billTo} onChange={(a) => upd({ billTo: a })} />
            <AddressBlock prefix="Shipping" value={v.shipTo} onChange={(a) => upd({ shipTo: a })} />
          </div>
        </section>

        <section className="crm-po-section" aria-label="Ordered Items">
          <LineItemsGrid
            documentType="salesOrder"
            value={grid}
            onChange={(g) => (setGrid(g), setDirty(true))}
            products={products}
            taxOptions={data?.grid.taxes ?? [{ name: "VAT", rate: 7.5 }]}
            taxMode={data?.grid.taxMode ?? "LINE"}
            currency={v.currency}
            brandId={brandId}
            canAdjust={data?.grid.canAdjust ?? true}
            showVins
            requireProduct={data?.grid.requireProduct ?? false}
            extraRows={[
              ...(otherInTotal ? [{ label: "Other Charges", amount: n(v.otherCharges), inTotal: true, testId: "total-other-charges" }] : []),
              ...(n(v.exciseDuty) > 0 || exciseInTotal ? [{ label: "Excise Duty", amount: n(v.exciseDuty), inTotal: exciseInTotal, testId: "total-excise" }] : []),
            ]}
          />
          {err("items")}
        </section>

        <section className="crm-po-section" aria-labelledby="so-terms-title">
          <h2 id="so-terms-title" className="crm-po-section-title">
            Terms and Conditions
          </h2>
          <div className="crm-po-field crm-po-field-wide">
            <label htmlFor="so-terms">Terms and Conditions</label>
            <textarea id="so-terms" className="crm-po-input" value={v.terms} onChange={(e) => upd({ terms: e.target.value })} maxLength={4000} />
          </div>
        </section>
        <section className="crm-po-section" aria-labelledby="so-desc-title">
          <h2 id="so-desc-title" className="crm-po-section-title">
            Description Information
          </h2>
          <div className="crm-po-field crm-po-field-wide">
            <label htmlFor="so-description">Description</label>
            <textarea id="so-description" className="crm-po-input" value={v.description} onChange={(e) => upd({ description: e.target.value })} maxLength={4000} />
          </div>
        </section>
      </div>
    </div>
  );
}
