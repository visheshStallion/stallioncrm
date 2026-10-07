"use client";

import { Handshake, Lock, User, UserSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { DateInput, Field, Lookup, type DateFormat } from "@/components/crm/form-kit";
import { LineItemsGrid, gridPayload, newLine, type GridValue } from "@/components/crm/LineItemsGrid";
import { toast } from "@/components/Toaster";
import { COUNTRIES } from "@/lib/countries";
import { brandProductsAction } from "@/server/modules/documents/actions";
import { accountLinksAction } from "@/server/modules/documents/invoice-actions";
import type { GridProduct } from "@/server/modules/documents/lookups";
import { quoteFormDataAction, saveQuotePageAction } from "@/server/modules/documents/quote-actions";
import type { QuoteFormData } from "@/server/modules/documents/quote-page";
import { AccountField, type Hit } from "../invoices/InvoiceForm";

const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;
const STAGES: Record<string, string> = { DRAFT: "Draft", PENDING_APPROVAL: "Pending Approval", APPROVED: "Approved", SENT: "Sent", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Expired" };

export interface QuoteValues {
  ownerId: string;
  subject: string;
  orgName: string;
  orgAddress: string;
  orgCity: string;
  orgCountry: string;
  tinNumber: string;
  phone: string;
  email: string;
  quoteDate: string;
  validUntil: string;
  currency: string;
  exchangeRate: string;
  dealId: string;
  accountId: string;
  customerName: string;
  contactId: string;
  billTo: { street?: string; city?: string; state?: string; country?: string };
  terms: string;
  description: string;
}

export interface QuoteFormProps {
  mode: "create" | "edit" | "clone";
  id?: string;
  number?: string;
  status?: string;
  brands: Array<{ id: string; code: string; name: string }>;
  brandId: string;
  data: QuoteFormData | null;
  initial?: Partial<QuoteValues>;
  initialGrid?: GridValue;
  labels?: { contact?: { id: string; name: string } | null; deal?: { id: string; name: string } | null };
  dateFormat: DateFormat;
  designBrands: string[];
  today: string;
  userId: string;
  templateName?: string | null;
}

const EMPTY: QuoteValues = { ownerId: "", subject: "", orgName: "", orgAddress: "", orgCity: "", orgCountry: "Nigeria", tinNumber: "", phone: "", email: "", quoteDate: "", validUntil: "", currency: "NGN", exchangeRate: "1", dealId: "", accountId: "", customerName: "", contactId: "", billTo: { country: "Nigeria" }, terms: "", description: "" };
const plusDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Create / Edit Quote (Zoho-style page): Quote Information (customer organisation, subject, stage, TIN, currency,
 * quote date, owner, valid until, deal, phone, e-mail, exchange rate), Address Information (account, contact,
 * billing address), Quoted Items, Terms and Conditions. The server re-checks and recomputes everything.
 */
export function QuoteForm(p: QuoteFormProps) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(p.brandId);
  const [data, setData] = useState<QuoteFormData | null>(p.data);
  const [v, setV] = useState<QuoteValues>(() => {
    const start = { ...EMPTY, quoteDate: p.today, ...p.initial };
    if (!start.validUntil) start.validUntil = plusDays(start.quoteDate, 14);
    if (p.mode === "create" && !start.terms && p.data) start.terms = p.data.settings.terms;
    if (!start.ownerId && p.data?.owners.some((o) => o.id === p.userId)) start.ownerId = p.userId;
    return start;
  });
  const [grid, setGrid] = useState<GridValue>(() => p.initialGrid ?? { lines: [newLine({ key: "init0" }, [{ name: "VAT", rate: 7.5 }])], header: { discountType: "PERCENT", discountValue: "0", taxes: [], adjustment: "0" } });
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null }>>(p.labels?.contact ? [{ ...p.labels.contact, phone: null, email: null, address: null, city: null }] : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const upd = useCallback((patch: Partial<QuoteValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!brandId) return setData(null);
    if (first.current && p.data?.brand.id === brandId) return;
    void quoteFormDataAction(brandId).then((res) => {
      if (!res.ok) return toast(res.error.message, "error");
      setData(res.data);
      if (p.mode !== "edit") setV((cur) => ({ ...cur, ownerId: res.data.owners.some((o) => o.id === cur.ownerId) ? cur.ownerId : res.data.owners.some((o) => o.id === p.userId) ? p.userId : "", terms: cur.terms || res.data.settings.terms, dealId: "" }));
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

  const cancelHref = p.id ? `/quotes/${p.id}` : "/quotes";
  const cancel = () => {
    if (dirty && !window.confirm("Discard the changes to this quote?")) return;
    setDirty(false);
    router.push(cancelHref);
  };
  const rateLocked = v.currency === "NGN" || !data?.canEditRate;
  const deals = (data?.deals ?? []).filter((d) => !v.accountId || !d.accountId || d.accountId === v.accountId);
  const dealOptions = [...deals.map((d) => ({ id: d.id, label: d.name })), ...(p.labels?.deal && !deals.some((d) => d.id === p.labels!.deal!.id) ? [{ id: p.labels.deal.id, label: p.labels.deal.name }] : [])];

  const pickAccount = (a: Hit) =>
    upd({
      accountId: a.id,
      customerName: a.name,
      contactId: "",
      orgName: v.orgName || (a.type === "INDIVIDUAL" ? "" : a.name),
      tinNumber: v.tinNumber || a.taxId || "",
      phone: v.phone || a.phone || "",
      email: v.email || a.email || "",
      billTo: { street: a.address ?? "", city: a.city ?? "", state: a.state ?? "", country: "Nigeria" },
    });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!brandId) e.brand = "Choose the brand";
    if (!v.customerName.trim() && !v.orgName.trim()) e.account = "Pick an account, type the customer's name or enter the organisation";
    else if (data?.settings.requireAccount && !v.accountId) e.account = "This brand needs a linked account – pick one";
    if (v.phone.trim().length < 7) e.phone = "Enter the phone number";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid e-mail address";
    if (!grid.lines.some((l) => (l.description.trim() || l.productId) && Number(l.qty) > 0)) e.items = "Add at least one quoted item";
    if (v.validUntil && v.quoteDate && v.validUntil < v.quoteDate) e.validUntil = "Valid until cannot be before the quote date";
    if (v.currency !== "NGN" && !(Number(v.exchangeRate) > 0)) e.exchangeRate = "No exchange rate for this currency";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const save = (mode: "save" | "new") => {
    if (pending) return;
    if (!validate()) return toast("Check the highlighted fields", "error");
    start(async () => {
      const payload = { brandId, ...v, ownerId: v.ownerId || undefined, accountId: v.accountId || undefined, contactId: v.contactId || undefined, dealId: v.dealId || undefined, ...gridPayload(grid) };
      const res = await saveQuotePageAction(p.mode === "edit" ? p.id! : null, payload, mode);
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

  const canDesign = p.designBrands.includes(brandId);
  const title = p.mode === "edit" ? `Edit Quote${p.number ? ` ${p.number}` : ""}` : p.mode === "clone" ? "Clone Quote" : "Create Quote";
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null);
  const blank = <div className="hidden lg:block" aria-hidden />;
  const txt = (id: string, label: string, key: keyof QuoteValues, extra: { req?: boolean; max?: number; type?: string; placeholder?: string; list?: string } = {}) => (
    <Field label={label} htmlFor={id}>
      <input id={id} type={extra.type ?? "text"} list={extra.list} className={`crm-po-input${extra.req ? " crm-po-req" : ""}`} value={v[key] as string} onChange={(e) => upd({ [key]: e.target.value } as Partial<QuoteValues>)} maxLength={extra.max ?? 200} placeholder={extra.placeholder} aria-required={extra.req || undefined} />
      {err(key)}
    </Field>
  );

  return (
    <div data-testid="quote-form">
      <datalist id="po-countries">
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>{title}</h1>
          {canDesign ? (
            <Link href="/setup/modules-fields" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="crm-btn crm-btn-secondary" onClick={cancel} data-testid="q-cancel">
            Cancel
          </button>
          {p.mode !== "edit" ? (
            <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={() => save("new")} data-testid="q-save-new">
              Save and New
            </button>
          ) : null}
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={() => save("save")} data-testid="q-save">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {p.templateName ? <p className="mb-3 text-[13px] text-text-muted">From the template “{p.templateName}”</p> : null}

      <div className="crm-po-card">
        <section className="crm-po-section" aria-labelledby="q-info">
          <h2 id="q-info" className="crm-po-section-title">
            Quote Information
          </h2>
          <div className="crm-po-fields">
            {txt("q-org-name", "Organization Name", "orgName")}
            <Field label="Quote Date" htmlFor="q-date">
              <DateInput id="q-date" label="Quote Date" value={v.quoteDate} onChange={(iso) => upd({ quoteDate: iso })} format={p.dateFormat} />
            </Field>
            {txt("q-org-address", "Organization Address", "orgAddress", { max: 400 })}
            <Field label="Quote Owner" htmlFor="q-owner">
              <Lookup id="q-owner" label="Quote Owner" value={v.ownerId} options={(data?.owners ?? []).map((o) => ({ id: o.id, label: o.name }))} onChange={(id) => upd({ ownerId: id })} icon={<UserSearch className="h-4 w-4" aria-hidden />} required testId="q-owner" />
            </Field>
            {txt("q-org-city", "Organization City", "orgCity", { max: 80 })}
            <Field label="Valid Until" htmlFor="q-valid">
              <DateInput id="q-valid" label="Valid Until" value={v.validUntil} onChange={(iso) => upd({ validUntil: iso })} format={p.dateFormat} invalid={!!errors.validUntil} />
              {err("validUntil")}
            </Field>
            {txt("q-org-country", "Organization Country", "orgCountry", { max: 80, list: "po-countries" })}
            <Field label="Deal Name" htmlFor="q-deal">
              <Lookup id="q-deal" label="Deal Name" value={v.dealId} options={dealOptions} onChange={(id) => upd({ dealId: id })} icon={<Handshake className="h-4 w-4" aria-hidden />} disabled={!brandId} testId="q-deal" />
            </Field>
            {txt("q-subject", "Subject", "subject", { max: 255, placeholder: "e.g. Tucson 2.0 GLS – Adeyemi" })}
            {txt("q-phone", "Phone Number", "phone", { req: true, max: 40, type: "tel", placeholder: "+234 …" })}
            <Field label="Quote Stage" htmlFor="q-stage">
              <select id="q-stage" className="crm-po-input" value={p.status ?? "DRAFT"} disabled title="The stage changes with the buttons on the quote (submit, approval, sent, accepted)">
                {Object.entries(STAGES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {txt("q-email", "Email Id", "email", { req: true, max: 254, type: "email" })}
            {txt("q-tin", "TIN Number", "tinNumber", { max: 20, placeholder: "12345678-0001" })}
            <Field label="Exchange Rate" htmlFor="q-rate">
              <div className="crm-po-addon">
                <input id="q-rate" type="number" min={0} step="0.000001" className="crm-po-input" value={v.exchangeRate} readOnly={rateLocked} onChange={(e) => upd({ exchangeRate: e.target.value })} />
                <span className="crm-po-iconbtn cursor-default" title={rateLocked ? (v.currency === "NGN" ? "Naira: always 1" : "From Setup → Currencies") : "You may change the rate"}>
                  <Lock className="h-4 w-4" aria-label={rateLocked ? "Locked" : "Editable"} />
                </span>
              </div>
              {err("exchangeRate")}
            </Field>
            <Field label="Currency" htmlFor="q-currency">
              <select id="q-currency" className="crm-po-input" value={v.currency} onChange={(e) => upd({ currency: e.target.value, exchangeRate: e.target.value === "NGN" ? "1" : String(data?.rates[e.target.value] ?? "") })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {blank}
            <Field label="Brand / Company" htmlFor="q-brand">
              <select id="q-brand" className="crm-po-input crm-po-req" value={brandId} disabled={p.mode === "edit" || p.brands.length === 1} aria-required onChange={(e) => (setBrandId(e.target.value), setDirty(true))}>
                <option value="">-None-</option>
                {p.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} – {b.name}
                  </option>
                ))}
              </select>
              {err("brand")}
            </Field>
          </div>
        </section>

        <section className="crm-po-section" aria-labelledby="q-address">
          <h2 id="q-address" className="crm-po-section-title">
            Address Information
          </h2>
          <div className="crm-po-fields">
            <Field label="Account Name" htmlFor="inv-account">
              <AccountField value={v.customerName} label="Account Name" linked={!!v.accountId} invalid={!!errors.account} onType={(name) => upd({ customerName: name, accountId: "", contactId: "" })} onPick={pickAccount} />
              {err("account")}
            </Field>
            {blank}
            <Field label="Contact Name" htmlFor="q-contact">
              <Lookup id="q-contact" label="Contact Name" value={v.contactId} options={contacts.map((c) => ({ id: c.id, label: c.name, sub: c.phone }))} onChange={(id) => {
                const c = contacts.find((x) => x.id === id);
                upd({ contactId: id, phone: v.phone || c?.phone || "", email: v.email || c?.email || "" });
              }} icon={<User className="h-4 w-4" aria-hidden />} disabled={!v.accountId} placeholder={v.accountId ? "Search" : "Pick an account first"} testId="q-contact" />
            </Field>
            {blank}
            {(["street", "city", "state", "country"] as const).map((k) => (
              <div key={k} className="contents">
                <Field label={`Billing ${k.charAt(0).toUpperCase()}${k.slice(1)}`} htmlFor={`billing-${k}`}>
                  <input id={`billing-${k}`} list={k === "country" ? "po-countries" : undefined} className="crm-po-input" value={v.billTo[k] ?? ""} onChange={(e) => upd({ billTo: { ...v.billTo, [k]: e.target.value } })} maxLength={k === "street" ? 400 : 80} />
                </Field>
                {blank}
              </div>
            ))}
          </div>
        </section>

        <section className="crm-po-section" aria-label="Quoted Items">
          <LineItemsGrid
            documentType="quote"
            value={grid}
            onChange={(g) => (setGrid(g), setDirty(true))}
            products={products}
            taxOptions={data?.grid.taxes ?? [{ name: "VAT", rate: 7.5 }]}
            taxMode={data?.grid.taxMode ?? "LINE"}
            currency={v.currency}
            brandId={brandId}
            canAdjust={data?.grid.canAdjust ?? true}
            requireProduct={data?.grid.requireProduct ?? false}
          />
          {err("items")}
        </section>

        <section className="crm-po-section" aria-labelledby="q-terms-title">
          <h2 id="q-terms-title" className="crm-po-section-title">
            Terms and Conditions
          </h2>
          <div className="crm-po-field crm-po-field-wide">
            <label htmlFor="q-terms">Terms and Conditions</label>
            <textarea id="q-terms" className="crm-po-input" value={v.terms} onChange={(e) => upd({ terms: e.target.value })} maxLength={4000} />
          </div>
        </section>
        <section className="crm-po-section" aria-labelledby="q-desc-title">
          <h2 id="q-desc-title" className="crm-po-section-title">
            Description Information
          </h2>
          <div className="crm-po-field crm-po-field-wide">
            <label htmlFor="q-description">Description</label>
            <textarea id="q-description" className="crm-po-input" value={v.description} onChange={(e) => upd({ description: e.target.value })} maxLength={4000} />
          </div>
        </section>
      </div>
    </div>
  );
}
