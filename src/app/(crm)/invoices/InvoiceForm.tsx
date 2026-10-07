"use client";

import { Building2, FileText, Handshake, Lock, User, UserSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AddressBlock, DateInput, Field, Lookup, Money, type Address, type DateFormat } from "@/components/crm/form-kit";
import { LineItemsGrid, gridPayload, newLine, type GridValue } from "@/components/crm/LineItemsGrid";
import { toast } from "@/components/Toaster";
import { COUNTRIES } from "@/lib/countries";
import { brandProductsAction } from "@/server/modules/documents/actions";
import { calcDocument } from "@/server/modules/documents/calc";
import { accountLinksAction, invoiceFormDataAction, orderForInvoiceAction, saveInvoicePageAction, searchAccountsAction } from "@/server/modules/documents/invoice-actions";
import type { InvoiceFormData } from "@/server/modules/documents/invoice-page";
import type { GridProduct } from "@/server/modules/documents/lookups";

const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;
const STATUS_LABELS: Record<string, string> = { DRAFT: "Created", PENDING_APPROVAL: "Pending Approval", APPROVED: "Approved", ISSUED: "Issued", SENT: "Sent", PART_PAID: "Partially Paid", PAID: "Paid", OVERDUE: "Overdue", VOID: "Void" };

export interface InvoiceValues {
  ownerId: string;
  subject: string;
  customerPoRef: string;
  invoiceDate: string;
  dueDate: string;
  salesCommission: string;
  exciseDuty: string;
  otherCharges: string;
  tinNumber: string;
  currency: string;
  exchangeRate: string;
  accountId: string;
  /** the customer: the picked account's name or a typed new customer */
  customerName: string;
  accountType: string;
  contactId: string;
  phone: string;
  dealId: string;
  salesOrderId: string;
  billTo: Address;
  shipTo: Address;
  terms: string;
  description: string;
  formViewId: string;
}

export interface InvoiceFormProps {
  mode: "create" | "edit" | "clone";
  id?: string;
  number?: string;
  status?: string;
  brands: Array<{ id: string; code: string; name: string }>;
  brandId: string;
  data: InvoiceFormData | null;
  initial?: Partial<InvoiceValues>;
  initialGrid?: GridValue;
  /** labels of pre-filled lookups (edit / clone / links) */
  labels?: { deal?: { id: string; name: string } | null; contact?: { id: string; name: string } | null; order?: { id: string; number: string } | null };
  dateFormat: DateFormat;
  designBrands: string[];
  today: string;
  userId: string;
  templateName?: string | null;
}

export type Hit = { id: string; name: string; type: string; taxId: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null };
const EMPTY: InvoiceValues = { ownerId: "", subject: "", customerPoRef: "", invoiceDate: "", dueDate: "", salesCommission: "", exciseDuty: "", otherCharges: "", tinNumber: "", currency: "NGN", exchangeRate: "1", accountId: "", customerName: "", accountType: "", contactId: "", phone: "", dealId: "", salesOrderId: "", billTo: {}, shipTo: {}, terms: "", description: "", formViewId: "" };
const money = (n: number) => n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plusDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Account Name: pick an existing account, or type a new customer's name (stored as the bill-to snapshot). */
export function AccountField({ value, label, linked, onType, onPick, invalid }: { value: string; label: string; linked: boolean; onType: (name: string) => void; onPick: (a: Hit) => void; invalid?: boolean }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(async () => {
      const res = await searchAccountsAction(q ?? "");
      if (res.ok) setHits(res.data as Hit[]);
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, open]);
  return (
    <div className="relative" data-testid="inv-account" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <div className="crm-po-addon">
        <input
          id="inv-account"
          role="combobox"
          aria-expanded={open}
          aria-controls="inv-account-list"
          aria-label={label}
          aria-required
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className="crm-po-input crm-po-req"
          placeholder="Search accounts or type a new customer"
          value={value}
          onChange={(e) => {
            onType(e.target.value);
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button type="button" className="crm-po-iconbtn" aria-label="Look up account name" onClick={() => (setQ(""), setOpen((o) => !o))}>
          <Building2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-text-muted" data-testid="inv-account-state">
        {linked ? "Linked to the account" : value.trim() ? "New customer – saved on the invoice only" : ""}
      </p>
      {open && hits.length ? (
        <div className="crm-po-menu" id="inv-account-list" role="listbox" aria-label="Account Name options">
          {hits.map((h) => (
            <button key={h.id} type="button" role="option" aria-selected={false} onClick={() => (onPick(h), setOpen(false), setQ(null))}>
              {h.name}
              <span className="block text-[11px] text-text-muted">{[h.type.charAt(0) + h.type.slice(1).toLowerCase(), h.city, h.phone].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Create / Edit / Clone Invoice (prompt 26): the reference layout with our own CSS – the PO page frame, Invoice
 * Information, Address Information, Invoiced Items with Other Charges and Excise Duty in the totals card, terms,
 * description and the form-view bar. The server re-checks and recomputes everything.
 */
export function InvoiceForm(p: InvoiceFormProps) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(p.brandId);
  const [data, setData] = useState<InvoiceFormData | null>(p.data);
  const [v, setV] = useState<InvoiceValues>(() => {
    const start = { ...EMPTY, invoiceDate: p.today, ...p.initial };
    if (!start.dueDate && p.data) start.dueDate = plusDays(start.invoiceDate, p.data.settings.paymentTermsDays);
    if (p.mode === "create" && !start.terms && p.data) start.terms = p.data.settings.terms;
    if (!start.billTo.country) start.billTo = { ...start.billTo, country: "Nigeria" };
    if (!start.shipTo.country) start.shipTo = { ...start.shipTo, country: "Nigeria" };
    if (!start.ownerId && p.data?.owners.some((o) => o.id === p.userId)) start.ownerId = p.userId;
    return start;
  });
  const [grid, setGrid] = useState<GridValue>(() => p.initialGrid ?? { lines: [newLine({ key: "init0" }, [{ name: "VAT", rate: 7.5 }])], header: { discountType: "PERCENT", discountValue: "0", taxes: [], adjustment: "0" } });
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [links, setLinks] = useState<{ contacts: Array<{ id: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null }>; deals: Array<{ id: string; name: string }> }>({ contacts: p.labels?.contact ? [{ ...p.labels.contact, phone: null, email: null, address: null, city: null }] : [], deals: p.labels?.deal ? [p.labels.deal] : [] });
  const [account, setAccount] = useState<Hit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pending, start] = useTransition();
  const first = useRef(true);

  const upd = useCallback((patch: Partial<InvoiceValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  }, []);

  // brand: lookups, products and defaults (owner, due date, terms)
  useEffect(() => {
    if (!brandId) return setData(null);
    if (first.current && p.data?.brand.id === brandId) return;
    void invoiceFormDataAction(brandId).then((res) => {
      if (!res.ok) return toast(res.error.message, "error");
      setData(res.data);
      if (p.mode !== "edit")
        setV((cur) => ({
          ...cur,
          ownerId: res.data.owners.some((o) => o.id === cur.ownerId) ? cur.ownerId : res.data.owners.some((o) => o.id === p.userId) ? p.userId : "",
          dueDate: plusDays(cur.invoiceDate || p.today, res.data.settings.paymentTermsDays),
          terms: cur.terms || res.data.settings.terms,
          salesOrderId: "",
          dealId: "",
        }));
    });
  }, [brandId, p.data, p.mode, p.userId, p.today]);
  useEffect(() => {
    if (!brandId) return setProducts([]);
    void brandProductsAction(brandId).then((res) => res.ok && setProducts(res.data.products));
  }, [brandId]);
  // contacts of the account, deals of the brand (for the account)
  useEffect(() => {
    if (!brandId) return;
    void accountLinksAction(brandId, v.accountId || null).then((res) => res.ok && setLinks(res.data));
  }, [brandId, v.accountId]);
  useEffect(() => {
    first.current = false;
  }, []);

  // unsaved-changes guard
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cancelHref = p.id ? `/invoices/${p.id}` : "/invoices";
  const cancel = () => {
    if (dirty && !window.confirm("Discard the changes to this invoice?")) return;
    setDirty(false);
    router.push(cancelHref);
  };

  const view = data?.settings.formViews.find((x) => x.id === v.formViewId) ?? null;
  const hide = (part: string) => !!view?.hidden.includes(part);
  const rateLocked = v.currency === "NGN" || !data?.canEditRate;
  const contact = links.contacts.find((c) => c.id === v.contactId) ?? null;

  const setInvoiceDate = (iso: string) => upd({ invoiceDate: iso, dueDate: data && (!v.dueDate || v.dueDate === plusDays(v.invoiceDate, data.settings.paymentTermsDays)) ? plusDays(iso, data.settings.paymentTermsDays) : v.dueDate });
  const pickAccount = (a: Hit) => {
    setAccount(a);
    upd({
      accountId: a.id,
      customerName: a.name,
      accountType: a.type,
      contactId: "",
      dealId: "",
      tinNumber: v.tinNumber || a.taxId || "",
      phone: v.phone || a.phone || "",
      billTo: { street: a.address ?? "", city: a.city ?? "", state: a.state ?? "", country: "Nigeria" },
    });
  };
  const pickOrder = (orderId: string) => {
    if (!orderId) return upd({ salesOrderId: "" });
    const label = data?.orders.find((o) => o.id === orderId)?.number ?? "the sales order";
    if (!window.confirm(`Copy details and items from ${label}?`)) return upd({ salesOrderId: orderId });
    start(async () => {
      const res = await orderForInvoiceAction(orderId);
      if (!res.ok) return toast(res.error.message, "error");
      const o = res.data;
      if (o.contact) setLinks((l) => ({ ...l, contacts: l.contacts.some((c) => c.id === o.contact!.id) ? l.contacts : [...l.contacts, { ...o.contact!, phone: null, email: null, address: null, city: null }] }));
      if (o.dealId && o.dealName) setLinks((l) => ({ ...l, deals: l.deals.some((d) => d.id === o.dealId) ? l.deals : [...l.deals, { id: o.dealId!, name: o.dealName! }] }));
      upd({
        salesOrderId: orderId,
        accountId: o.account?.id ?? "",
        accountType: o.account?.type ?? "",
        customerName: o.customerName,
        contactId: o.contact?.id ?? "",
        dealId: o.dealId ?? "",
        phone: o.phone ?? "",
        tinNumber: o.tinNumber ?? "",
        currency: o.currency,
        exchangeRate: o.currency === "NGN" ? "1" : String(data?.rates[o.currency] ?? ""),
        terms: o.terms || v.terms,
        billTo: o.billTo,
        shipTo: o.shipTo,
        subject: v.subject || `${o.number} – ${o.customerName}`,
      });
      setGrid({
        lines: o.lines.map((l, i) => newLine({ key: `so${i}`, productId: l.productId ?? "", description: l.description, details: l.details ?? "", itemCode: l.itemCode ?? "", uom: l.uom ?? "", qty: String(l.qty), unitPrice: String(l.unitPrice), discountType: l.discountType, discountValue: String(l.discountValue), taxes: l.taxes.map(({ name, rate }) => ({ name, rate })), vins: l.vins, isStockItem: l.isStockItem, sourceLineId: l.sourceLineId })),
        header: { discountType: o.headerDiscountType, discountValue: String(o.headerDiscountValue), taxes: o.documentTaxes, adjustment: "0" },
      });
      toast(`Copied from ${o.number} – only what is not invoiced yet`, "success");
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!brandId) e.brand = "Choose the brand";
    if (!v.subject.trim()) e.subject = "Enter the subject";
    if (!v.customerName.trim()) e.account = "Pick an account or type the customer's name";
    else if (data?.settings.requireAccount && !v.accountId) e.account = "This brand needs a linked account – pick one";
    if (!grid.lines.some((l) => (l.description.trim() || l.productId) && Number(l.qty) > 0)) e.items = "Add at least one invoiced item with a quantity";
    if (v.dueDate && v.invoiceDate && v.dueDate < v.invoiceDate) e.dueDate = "The due date cannot be before the invoice date";
    if (v.currency !== "NGN" && !(Number(v.exchangeRate) > 0)) e.exchangeRate = "No exchange rate for this currency";
    if (data?.settings.tinRequiredB2B && v.accountId && v.accountType && v.accountType !== "INDIVIDUAL" && !v.tinNumber.trim()) e.tin = "The brand requires the TIN of companies";
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
        ownerId: v.ownerId || undefined,
        subject: v.subject,
        customerPoRef: v.customerPoRef,
        invoiceDate: v.invoiceDate,
        dueDate: v.dueDate,
        salesCommission: v.salesCommission,
        exciseDuty: v.exciseDuty,
        otherCharges: v.otherCharges,
        tinNumber: v.tinNumber,
        currency: v.currency,
        exchangeRate: v.exchangeRate,
        accountId: v.accountId || undefined,
        customerName: v.customerName,
        contactId: v.contactId || undefined,
        phone: v.phone,
        dealId: v.dealId || undefined,
        salesOrderId: v.salesOrderId || undefined,
        billTo: v.billTo,
        shipTo: v.shipTo,
        terms: v.terms,
        description: v.description,
        formViewId: v.formViewId,
        ...g,
      };
      const res = await saveInvoicePageAction(p.mode === "edit" ? p.id! : null, payload, mode);
      if (!res.ok) return toast(res.error.message, "error");
      setDirty(false);
      toast(res.data.message, "success");
      router.push(res.data.redirect);
      if (mode === "new") router.refresh();
    });
  };
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

  const otherInTotal = data?.settings.otherChargesEnabled ?? true;
  const exciseInTotal = data?.settings.exciseInTotal ?? false;
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
      if (!account && !v.accountId) return toast("Pick an account first", "error");
      if (account) upd({ billTo: { street: account.address ?? "", city: account.city ?? "", state: account.state ?? "", country: "Nigeria" } });
    } else {
      if (!contact) return toast("Choose the contact first", "error");
      upd({ billTo: { ...v.billTo, street: contact.address ?? v.billTo.street, city: contact.city ?? v.billTo.city } });
    }
  };

  const canDesign = p.designBrands.includes(brandId);
  const title = p.mode === "edit" ? `Edit Invoice${p.number ? ` ${p.number}` : ""}` : p.mode === "clone" ? "Clone Invoice" : "Create Invoice";
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null);
  const blank = <div className="hidden lg:block" aria-hidden />;
  const n = (s: string) => Number(s) || 0;

  return (
    <div data-testid="invoice-form">
      <datalist id="po-countries">
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>{title}</h1>
          {canDesign ? (
            <Link href={`/setup/invoice-settings?brand=${brandId}#form-views`} className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="crm-btn crm-btn-secondary" onClick={cancel} data-testid="inv-cancel">
            Cancel
          </button>
          {p.mode !== "edit" ? (
            <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={() => save("new")} data-testid="inv-save-new">
              Save and New
            </button>
          ) : null}
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={() => save("save")} data-testid="inv-save">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {p.templateName ? <p className="mb-3 text-[13px] text-text-muted">From the template “{p.templateName}”</p> : null}

      <div className="crm-po-card">
        <section className="crm-po-section" aria-labelledby="inv-info">
          <h2 id="inv-info" className="crm-po-section-title">
            Invoice Information
          </h2>
          <div className="crm-po-fields">
            <Field label="Invoice Owner" htmlFor="inv-owner">
              <Lookup id="inv-owner" label="Invoice Owner" value={v.ownerId} options={(data?.owners ?? []).map((o) => ({ id: o.id, label: o.name }))} onChange={(id) => upd({ ownerId: id })} icon={<UserSearch className="h-4 w-4" aria-hidden />} required testId="inv-owner" />
            </Field>
            <Field label="Sales Order" htmlFor="inv-order">
              <Lookup id="inv-order" label="Sales Order" value={v.salesOrderId} options={[...(data?.orders ?? []).map((o) => ({ id: o.id, label: o.number, sub: o.customer })), ...(p.labels?.order && !(data?.orders ?? []).some((o) => o.id === p.labels!.order!.id) ? [{ id: p.labels.order.id, label: p.labels.order.number }] : [])]} onChange={pickOrder} icon={<FileText className="h-4 w-4" aria-hidden />} disabled={!brandId || p.mode === "edit"} placeholder="Confirmed orders with items to invoice" testId="inv-order" />
            </Field>
            <Field label="Brand / Company" htmlFor="inv-brand">
              <select id="inv-brand" className="crm-po-input crm-po-req" value={brandId} disabled={p.mode === "edit" || p.brands.length === 1} aria-required onChange={(e) => (setBrandId(e.target.value), setDirty(true))}>
                <option value="">-None-</option>
                {p.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} – {b.name}
                  </option>
                ))}
              </select>
              {err("brand")}
            </Field>
            {hide("customerPoRef") ? (
              blank
            ) : (
              <Field label="Purchase Order" htmlFor="inv-po-ref">
                <input id="inv-po-ref" className="crm-po-input" value={v.customerPoRef} onChange={(e) => upd({ customerPoRef: e.target.value })} maxLength={80} placeholder="The customer's PO reference" />
              </Field>
            )}
            <Field label="Subject" htmlFor="inv-subject">
              <input id="inv-subject" className="crm-po-input crm-po-req" value={v.subject} onChange={(e) => upd({ subject: e.target.value })} maxLength={255} aria-required aria-invalid={!!errors.subject || undefined} placeholder="e.g. Tucson 2.0 GLS – Adeyemi" />
              {err("subject")}
            </Field>
            {hide("exciseDuty") ? (
              blank
            ) : (
              <Field label="Excise Duty" htmlFor="inv-excise">
                <Money id="inv-excise" label="Excise Duty" value={v.exciseDuty} onChange={(x) => upd({ exciseDuty: x })} tip={exciseInTotal ? "Excise duty on the goods – added to the Grand Total (brand setting); printed when above 0" : "Excise duty – printed when above 0; the brand does not add it to the Grand Total"} />
              </Field>
            )}
            <Field label="Invoice Date" htmlFor="inv-date">
              <DateInput id="inv-date" label="Invoice Date" value={v.invoiceDate} onChange={setInvoiceDate} format={p.dateFormat} />
            </Field>
            <Field label="Status" htmlFor="inv-status">
              <select id="inv-status" className="crm-po-input" value={p.status ?? "DRAFT"} disabled title="The status changes with the buttons on the invoice (approval, issue, payments)">
                {Object.entries(STATUS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due Date" htmlFor="inv-due">
              <DateInput id="inv-due" label="Due Date" value={v.dueDate} onChange={(iso) => upd({ dueDate: iso })} format={p.dateFormat} invalid={!!errors.dueDate} />
              {err("dueDate")}
            </Field>
            {hide("tinNumber") ? (
              blank
            ) : (
              <Field label="TIN Number" htmlFor="inv-tin">
                <input id="inv-tin" className={`crm-po-input${data?.settings.tinRequiredB2B && v.accountType && v.accountType !== "INDIVIDUAL" ? " crm-po-req" : ""}`} value={v.tinNumber} onChange={(e) => upd({ tinNumber: e.target.value })} maxLength={20} placeholder="12345678-0001" />
                {err("tin")}
              </Field>
            )}
            {hide("salesCommission") ? (
              blank
            ) : (
              <Field label="Sales Commission" htmlFor="inv-commission">
                <Money id="inv-commission" label="Sales Commission" value={v.salesCommission} onChange={(x) => upd({ salesCommission: x })} tip="Commission on this sale – used in commission reports, not added to the total" />
              </Field>
            )}
            <Field label="Currency" htmlFor="inv-currency">
              <select id="inv-currency" className="crm-po-input" value={v.currency} onChange={(e) => upd({ currency: e.target.value, exchangeRate: e.target.value === "NGN" ? "1" : String(data?.rates[e.target.value] ?? "") })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Account Name" htmlFor="inv-account">
              <AccountField
                value={v.customerName}
                label="Account Name"
                linked={!!v.accountId}
                invalid={!!errors.account}
                onType={(name) => {
                  setAccount(null);
                  upd({ customerName: name, accountId: "", accountType: "", contactId: "" });
                }}
                onPick={pickAccount}
              />
              {err("account")}
            </Field>
            {blank}
            <Field label="Contact Name" htmlFor="inv-contact">
              <Lookup id="inv-contact" label="Contact Name" value={v.contactId} options={links.contacts.map((c) => ({ id: c.id, label: c.name, sub: c.phone }))} onChange={(id) => upd({ contactId: id, phone: v.phone || links.contacts.find((c) => c.id === id)?.phone || "" })} icon={<User className="h-4 w-4" aria-hidden />} disabled={!v.accountId} placeholder={v.accountId ? "Search" : "Pick an account first"} testId="inv-contact" />
            </Field>
            {blank}
            <Field label="Phone Number" htmlFor="inv-phone">
              <input id="inv-phone" type="tel" className="crm-po-input" value={v.phone} onChange={(e) => upd({ phone: e.target.value })} maxLength={40} placeholder="+234 …" />
            </Field>
            {blank}
            {hide("dealId") ? null : (
              <>
                <Field label="Deal Name" htmlFor="inv-deal">
                  <Lookup id="inv-deal" label="Deal Name" value={v.dealId} options={links.deals.map((d) => ({ id: d.id, label: d.name }))} onChange={(id) => upd({ dealId: id })} icon={<Handshake className="h-4 w-4" aria-hidden />} disabled={!brandId} testId="inv-deal" />
                </Field>
                {blank}
              </>
            )}
            {hide("otherCharges") || !otherInTotal ? null : (
              <>
                <Field label="Add Other Charges" htmlFor="inv-other">
                  <Money id="inv-other" label="Add Other Charges" value={v.otherCharges} onChange={(x) => upd({ otherCharges: x })} tip="Delivery, registration, plate number, documentation … – added to the Grand Total as “Other Charges”" />
                </Field>
                {blank}
              </>
            )}
            <Field label="Exchange Rate" htmlFor="inv-rate">
              <div className="crm-po-addon">
                <input id="inv-rate" type="number" min={0} step="0.000001" className="crm-po-input" value={v.exchangeRate} readOnly={rateLocked} onChange={(e) => upd({ exchangeRate: e.target.value })} aria-describedby="inv-rate-hint" />
                <span className="crm-po-iconbtn cursor-default" title={rateLocked ? (v.currency === "NGN" ? "Naira: always 1" : "From Setup → Currencies – only users allowed to edit exchange rates can change it") : "You may change the rate"}>
                  <Lock className="h-4 w-4" aria-label={rateLocked ? "Locked" : "Editable"} />
                </span>
              </div>
              <p id="inv-rate-hint" className="mt-1 text-xs text-text-muted" data-testid="inv-ngn-total">
                {v.currency === "NGN" ? "₦ per ₦" : `₦ per 1 ${v.currency}`} · Grand Total ≈ ₦{money(ngnTotal)}
              </p>
              {err("exchangeRate")}
            </Field>
          </div>
        </section>

        {hide("address") ? null : (
          <section className="crm-po-section" aria-labelledby="inv-address">
            <div className="crm-po-section-title">
              <h2 id="inv-address">Address Information</h2>
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
        )}

        <section className="crm-po-section" aria-label="Invoiced Items">
          <LineItemsGrid
            documentType="invoice"
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
              ...(otherInTotal && !hide("otherCharges") ? [{ label: "Other Charges", amount: n(v.otherCharges), inTotal: true, testId: "total-other-charges" }] : []),
              ...(n(v.exciseDuty) > 0 || exciseInTotal ? [{ label: "Excise Duty", amount: n(v.exciseDuty), inTotal: exciseInTotal, testId: "total-excise" }] : []),
            ]}
          />
          {err("items")}
          <p className="mt-1 text-xs text-text-muted">A vehicle line can be saved without its VIN; the invoice is issued only when every unit has one.</p>
        </section>

        {hide("terms") ? null : (
          <section className="crm-po-section" aria-labelledby="inv-terms-title">
            <h2 id="inv-terms-title" className="crm-po-section-title">
              Terms and Conditions
            </h2>
            <Field label="Terms and Conditions" htmlFor="inv-terms">
              <textarea id="inv-terms" className="crm-po-input" value={v.terms} onChange={(e) => upd({ terms: e.target.value })} maxLength={4000} />
            </Field>
          </section>
        )}
        {hide("description") ? null : (
          <section className="crm-po-section" aria-labelledby="inv-desc-title">
            <h2 id="inv-desc-title" className="crm-po-section-title">
              Description Information
            </h2>
            <Field label="Description" htmlFor="inv-description">
              <textarea id="inv-description" className="crm-po-input" value={v.description} onChange={(e) => upd({ description: e.target.value })} maxLength={4000} />
            </Field>
          </section>
        )}
      </div>

      <div className="crm-po-footer" data-testid="po-footer">
        <label htmlFor="inv-view" className="text-[13px] text-text-muted">
          Create Form Views
        </label>
        <select id="inv-view" className="crm-po-input w-56" value={v.formViewId} onChange={(e) => upd({ formViewId: e.target.value })}>
          <option value="">Standard View</option>
          {(data?.settings.formViews ?? []).map((fv) => (
            <option key={fv.id} value={fv.id}>
              {fv.name}
            </option>
          ))}
        </select>
        {canDesign ? (
          <Link href={`/setup/invoice-settings?brand=${brandId}&newView=1#form-views`} className="crm-btn crm-btn-secondary" data-testid="create-form-page">
            Create a custom form page
          </Link>
        ) : null}
      </div>
    </div>
  );
}
