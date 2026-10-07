"use client";

import { Info, Lock, UserSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Field } from "@/components/crm/form-kit";

const CAMPAIGN_TYPES: Record<string, string> = {
  ADVERTISEMENT: "Advertisement",
  BANNER_ADS: "Banner Ads",
  CONFERENCE: "Conference",
  DIRECT_MAIL: "Direct mail",
  EMAIL: "Email",
  EVENT: "Event",
  LAUNCH: "Launch",
  PARTNERS: "Partners",
  PROMO: "Promotion",
  PUBLIC_RELATIONS: "Public Relations",
  REFERRAL_PROGRAM: "Referral Program",
  SERVICE_REMINDER: "Service reminder",
  TELEMARKETING: "Telemarketing",
  TRADE_SHOW: "Trade Show",
  WEBINAR: "Webinar",
  OTHERS: "Others",
};
const AUDIENCES: Record<string, string> = { ALL_LEADS: "Open leads of the brand", ALL_CUSTOMERS: "Customers of the brand (contacts on its deals)", REPORT: "Records of a saved report (leads or deals)" };
const PLAN_STATUSES = ["Planning", "Active", "Inactive", "Complete"];
const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"];

export interface CampaignValues {
  id?: string;
  brandId?: string;
  name?: string;
  type?: string;
  channel?: string;
  budget?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  templateId?: string | null;
  audienceKind?: string;
  reportId?: string | null;
  ownerId?: string | null;
  planStatus?: string | null;
  expectedRevenue?: number | null;
  actualCost?: number | null;
  expectedResponse?: number | null;
  numbersSent?: number | null;
  currency?: string;
  description?: string | null;
}

const input = "crm-po-input";
function MoneyIn({ id, name, value, tip }: { id: string; name: string; value: number | null | undefined; tip: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="crm-po-addon flex-1">
        <span className="crm-po-prefix">₦</span>
        <input id={id} name={name} type="number" min={0} step="0.01" className={input} defaultValue={value ?? ""} />
      </div>
      <span role="img" aria-label={tip} title={tip} className="text-text-muted">
        <Info className="h-4 w-4" aria-hidden />
      </span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crm-po-section">
      <h2 className="crm-po-section-title">{title}</h2>
      <div className="crm-po-fields">{children}</div>
    </section>
  );
}

/**
 * Campaign form (create + edit of a draft), Zoho-style page: Campaign Information (owner, type, name, status, dates,
 * expected revenue, budgeted / actual cost, expected response, numbers sent, currency, exchange rate) plus our
 * sending set-up (brand, channel, audience, template) and Description. The brand is fixed after creation.
 */
export function CampaignFields({
  values = {},
  brands,
  templates,
  reports,
  owners = [],
  rates = { NGN: 1 },
  userId,
}: {
  values?: CampaignValues;
  brands: Array<{ id: string; label: string }>;
  templates: Array<{ id: string; label: string }>;
  reports: Array<{ id: string; label: string }>;
  owners?: Array<{ id: string; name: string; brandIds: string[] }>;
  rates?: Record<string, number>;
  userId?: string;
}) {
  const edit = !!values.id;
  const [brandId, setBrandId] = useState(values.brandId ?? (brands.length === 1 ? brands[0]!.id : ""));
  const [currency, setCurrency] = useState(values.currency ?? "NGN");
  const brandOwners = owners.filter((o) => !brandId || o.brandIds.includes(brandId));
  return (
    <div className="crm-po-card" data-testid="campaign-form">
      <Section title="Campaign Information">
        <Field label="Campaign Owner" htmlFor="ownerId">
          <div className="crm-po-addon">
            <select id="ownerId" name="ownerId" className={input} defaultValue={values.ownerId ?? userId ?? ""} key={brandId}>
              {brandOwners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="crm-po-iconbtn cursor-default" aria-hidden>
              <UserSearch className="h-4 w-4" />
            </span>
          </div>
        </Field>
        <Field label="Type" htmlFor="type">
          <select id="type" name="type" className={`${input} crm-po-req`} defaultValue={values.type ?? ""} required aria-required>
            <option value="">-None-</option>
            {Object.entries(CAMPAIGN_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Campaign Name" htmlFor="name">
          <input id="name" name="name" className={`${input} crm-po-req`} required maxLength={120} defaultValue={values.name ?? ""} aria-required />
        </Field>
        <Field label="Status" htmlFor="planStatus">
          <select id="planStatus" name="planStatus" className={input} defaultValue={values.planStatus ?? ""}>
            <option value="">-None-</option>
            {PLAN_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Start Date" htmlFor="startDate">
          <input id="startDate" name="startDate" type="date" className={input} defaultValue={values.startDate ?? ""} />
        </Field>
        <Field label="End Date" htmlFor="endDate">
          <input id="endDate" name="endDate" type="date" className={input} defaultValue={values.endDate ?? ""} />
        </Field>
        <Field label="Expected Revenue" htmlFor="expectedRevenue">
          <MoneyIn id="expectedRevenue" name="expectedRevenue" value={values.expectedRevenue} tip="Revenue the campaign is expected to bring – compared with the won revenue of its deals" />
        </Field>
        <Field label="Budgeted Cost" htmlFor="budget">
          <MoneyIn id="budget" name="budget" value={values.budget} tip="The campaign budget – the ROI is calculated on it" />
        </Field>
        <Field label="Actual Cost" htmlFor="actualCost">
          <MoneyIn id="actualCost" name="actualCost" value={values.actualCost} tip="What the campaign really cost" />
        </Field>
        <Field label="Expected Response" htmlFor="expectedResponse">
          <input id="expectedResponse" name="expectedResponse" type="number" min={0} step="1" className={input} defaultValue={values.expectedResponse ?? ""} placeholder="number of responses" />
        </Field>
        <Field label="Numbers sent" htmlFor="numbersSent">
          <input id="numbersSent" name="numbersSent" type="number" min={0} step="1" className={input} defaultValue={values.numbersSent ?? ""} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <select id="currency" name="currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Exchange Rate" htmlFor="exchangeRate">
          <div className="crm-po-addon">
            <input id="exchangeRate" className={input} value={currency === "NGN" ? "1" : String(rates[currency] ?? "—")} readOnly />
            <span className="crm-po-iconbtn cursor-default" title={currency === "NGN" ? "Naira: always 1" : "From Setup → Currencies"}>
              <Lock className="h-4 w-4" aria-label="Locked" />
            </span>
          </div>
        </Field>
        <div className="hidden lg:block" aria-hidden />
      </Section>

      <Section title="Sending">
        <Field label="Brand / Company" htmlFor="brandId">
          {edit ? (
            <>
              <input type="hidden" name="brandId" value={values.brandId} />
              <input id="brandId" className={input} value={brands.find((b) => b.id === values.brandId)?.label ?? ""} readOnly disabled />
            </>
          ) : (
            <select id="brandId" name="brandId" required className={`${input} crm-po-req`} value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-required>
              <option value="">Choose brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Channel" htmlFor="channel">
          <select id="channel" name="channel" required className={`${input} crm-po-req`} defaultValue={values.channel ?? "EMAIL"} aria-required>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </Field>
        <Field label="Audience" htmlFor="audienceKind">
          <select id="audienceKind" name="audienceKind" className={input} defaultValue={values.audienceKind ?? "ALL_LEADS"}>
            {Object.entries(AUDIENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saved report" htmlFor="reportId">
          <select id="reportId" name="reportId" className={input} defaultValue={values.reportId ?? ""}>
            <option value="">—</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {edit ? (
          <Field label="Template" htmlFor="templateId">
            <select id="templateId" name="templateId" className={input} defaultValue={values.templateId ?? ""}>
              <option value="">Choose template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-xs text-text-muted lg:col-span-2">Only people you can see, with marketing consent for this brand, receive the campaign. The template is chosen once the brand and channel are fixed.</p>
        )}
      </Section>

      <section className="crm-po-section">
        <h2 className="crm-po-section-title">Description Information</h2>
        <div className="crm-po-field crm-po-field-wide">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" className={input} defaultValue={values.description ?? ""} maxLength={4000} />
        </div>
      </section>
    </div>
  );
}
