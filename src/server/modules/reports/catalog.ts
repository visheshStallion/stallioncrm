/**
 * Report catalog (pure data): the modules, joins and fields the report builder offers. The SQL fragments here
 * are the ONLY identifiers that ever reach a report query – user input selects keys from this catalog and is
 * otherwise bound as parameters. Sensitive customer fields (phone, email, IDs) are deliberately not offered.
 */
export type FieldType = "text" | "enum" | "number" | "money" | "percent" | "date";
export type JoinKey = "stage" | "account" | "model" | "owner" | "brand" | "region" | "deal";

export interface RField {
  key: string;
  label: string;
  type: FieldType;
  /** SQL expression over the base alias `t` and the join aliases */
  sql: string;
  joins?: JoinKey[];
  options?: string[];
}

export interface RModule {
  key: "deals" | "leads" | "quotes" | "documents" | "activities" | "cases";
  label: string;
  /** base table (alias t); soft-deleted rows are always excluded */
  table: string;
  joins: Partial<Record<JoinKey, string>>;
  fields: RField[];
  defaultColumns: string[];
  /** record page of a row, by id */
  path: string | null;
  /** default sort of tabular reports */
  defaultSort: string;
}

const common: RField[] = [
  { key: "brand", label: "Brand", type: "text", sql: `b.code`, joins: ["brand"] },
  { key: "region", label: "Region", type: "text", sql: `r.name`, joins: ["region"] },
  { key: "owner", label: "Owner", type: "text", sql: `u.name`, joins: ["owner"] },
  { key: "createdAt", label: "Created", type: "date", sql: `t."createdAt"` },
];
const baseJoins = {
  brand: `JOIN "Brand" b ON b.id = t."brandId"`,
  region: `JOIN "Region" r ON r.id = t."regionId"`,
  owner: `JOIN "User" u ON u.id = t."ownerId"`,
};
const activityCount = (parent: string): RField[] => [
  { key: "activityCount", label: "Activities", type: "number", sql: `(SELECT count(*) FROM "Activity" av WHERE av."parentType" = '${parent}' AND av."parentId" = t.id AND av."deletedAt" IS NULL)` },
  { key: "lastActivityAt", label: "Last activity", type: "date", sql: `(SELECT max(coalesce(av."completedAt", av."createdAt")) FROM "Activity" av WHERE av."parentType" = '${parent}' AND av."parentId" = t.id AND av."deletedAt" IS NULL)` },
];

export const REPORT_MODULES: RModule[] = [
  {
    key: "deals",
    label: "Deals",
    table: `"Deal"`,
    path: "/deals",
    defaultSort: "createdAt",
    joins: {
      ...baseJoins,
      stage: `JOIN "PipelineStage" s ON s.id = t."stageId"`,
      account: `LEFT JOIN "Account" a ON a.id = t."accountId"`,
      model: `LEFT JOIN "Product" p ON p.id = t."modelId"`,
    },
    defaultColumns: ["name", "brand", "region", "owner", "stage", "amount", "closeDate"],
    fields: [
      { key: "name", label: "Deal name", type: "text", sql: `t.name` },
      ...common,
      { key: "stage", label: "Stage", type: "text", sql: `s.name`, joins: ["stage"] },
      { key: "stageType", label: "Stage type", type: "enum", sql: `s.type`, joins: ["stage"], options: ["OPEN", "WON", "LOST"] },
      { key: "probability", label: "Probability %", type: "percent", sql: `s.probability`, joins: ["stage"] },
      { key: "amount", label: "Amount", type: "money", sql: `coalesce(t.amount, 0)` },
      { key: "weightedAmount", label: "Weighted amount", type: "money", sql: `round(coalesce(t.amount, 0) * s.probability / 100, 2)`, joins: ["stage"] },
      { key: "quantity", label: "Units", type: "number", sql: `t.quantity` },
      { key: "discountPct", label: "Discount %", type: "percent", sql: `t."discountPct"` },
      { key: "paymentType", label: "Payment type", type: "enum", sql: `t."paymentType"`, options: ["CASH", "BANK_FINANCE", "LEASE", "FLEET"] },
      { key: "closeDate", label: "Expected close", type: "date", sql: `t."closeDate"` },
      { key: "stageEnteredAt", label: "Stage entered / closed on", type: "date", sql: `t."stageEnteredAt"` },
      { key: "daysInStage", label: "Days in stage", type: "number", sql: `floor(extract(epoch FROM ((now() AT TIME ZONE 'UTC') - t."stageEnteredAt")) / 86400)::int` },
      { key: "lossReason", label: "Loss reason", type: "text", sql: `coalesce(t."lossReason", '(none)')` },
      { key: "lossCompetitorBrand", label: "Lost to (competitor)", type: "text", sql: `coalesce(t."lossCompetitorBrand", '(none)')` },
      // related modules
      { key: "account", label: "Account", type: "text", sql: `a.name`, joins: ["account"] },
      { key: "accountType", label: "Account type", type: "enum", sql: `a.type`, joins: ["account"], options: ["INDIVIDUAL", "COMPANY"] },
      { key: "accountCity", label: "Account city", type: "text", sql: `a.city`, joins: ["account"] },
      { key: "model", label: "Model", type: "text", sql: `p.name`, joins: ["model"] },
      { key: "modelCategory", label: "Product category", type: "text", sql: `p.category::text`, joins: ["model"] },
      ...activityCount("Deal"),
    ],
  },
  {
    key: "leads",
    label: "Leads",
    table: `"Lead"`,
    path: "/leads",
    defaultSort: "createdAt",
    joins: { ...baseJoins, model: `LEFT JOIN "Product" p ON p.id = t."modelOfInterestId"` },
    defaultColumns: ["name", "brand", "region", "owner", "status", "source", "createdAt"],
    fields: [
      { key: "name", label: "Lead name", type: "text", sql: `trim(coalesce(t."firstName", '') || ' ' || coalesce(t."lastName", t."company", ''))` },
      ...common,
      { key: "status", label: "Status", type: "enum", sql: `t.status`, options: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] },
      { key: "rating", label: "Rating", type: "enum", sql: `t.rating`, options: ["HOT", "WARM", "COLD"] },
      { key: "source", label: "Source", type: "enum", sql: `t.source`, options: ["WALK_IN", "WEBSITE", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "REFERRAL", "FLEET_CORPORATE", "EVENT", "PHONE"] },
      { key: "city", label: "City", type: "text", sql: `t.city` },
      { key: "budget", label: "Budget", type: "money", sql: `t.budget` },
      { key: "convertedAt", label: "Converted on", type: "date", sql: `t."convertedAt"` },
      { key: "model", label: "Model of interest", type: "text", sql: `p.name`, joins: ["model"] },
      ...activityCount("Lead"),
    ],
  },
  {
    // quotes, sales orders and invoices together (prompt 23): link status and non-stock vehicle lines. Each part is
    // read under row-level security, so the union only ever holds the viewer's documents.
    key: "documents",
    label: "Documents (quotes, orders, invoices)",
    table: `(SELECT id, 'Quote' AS "docType", number, status::text AS status, total, "issueDate", "brandId", "regionId", "ownerId", "createdAt", "deletedAt", "dealId", "accountId", "contactId", "sourceDocumentId", "billTo" FROM "Quote" UNION ALL SELECT id, 'Sales Order' AS "docType", number, status::text AS status, total, "issueDate", "brandId", "regionId", "ownerId", "createdAt", "deletedAt", "dealId", "accountId", "contactId", "sourceDocumentId", "billTo" FROM "SalesOrder" UNION ALL SELECT id, 'Invoice' AS "docType", number, status::text AS status, total, "issueDate", "brandId", "regionId", "ownerId", "createdAt", "deletedAt", "dealId", "accountId", "contactId", "sourceDocumentId", "billTo" FROM "Invoice")`,
    path: null,
    defaultSort: "issueDate",
    joins: { ...baseJoins },
    defaultColumns: ["docType", "number", "brand", "customer", "linkStatus", "status", "total", "issueDate"],
    fields: [
      { key: "docType", label: "Document type", type: "enum", sql: `t."docType"`, options: ["Quote", "Sales Order", "Invoice"] },
      { key: "number", label: "Number", type: "text", sql: `t.number` },
      ...common,
      { key: "status", label: "Status", type: "text", sql: `t.status` },
      { key: "customer", label: "Customer (bill-to)", type: "text", sql: `coalesce(t."billTo"->>'name', '(none)')` },
      { key: "linkStatus", label: "Link status", type: "enum", sql: `CASE WHEN t."dealId" IS NULL AND t."accountId" IS NULL AND t."contactId" IS NULL AND t."sourceDocumentId" IS NULL THEN 'Unlinked' ELSE 'Linked' END`, options: ["Linked", "Unlinked"] },
      { key: "total", label: "Total", type: "money", sql: `t.total` },
      { key: "issueDate", label: "Issue date", type: "date", sql: `t."issueDate"` },
      {
        key: "nonStockLines",
        label: "Non-stock vehicle lines",
        type: "number",
        sql: `(SELECT count(*)::int FROM "DocumentLine" dl WHERE (dl."quoteId" = t.id OR dl."salesOrderId" = t.id OR dl."invoiceId" = t.id) AND (dl."isStockItem" OR dl.vin IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM "VehicleUnit" vu WHERE vu."brandId" = t."brandId" AND vu.vin = dl.vin))`,
      },
    ],
  },
  {
    key: "quotes",
    label: "Quotes",
    table: `"Quote"`,
    path: "/quotes",
    defaultSort: "issueDate",
    joins: { ...baseJoins, deal: `JOIN "Deal" d ON d.id = t."dealId"`, account: `LEFT JOIN "Account" a ON a.id = t."accountId"` },
    defaultColumns: ["number", "brand", "region", "owner", "status", "total", "issueDate"],
    fields: [
      { key: "number", label: "Quote no.", type: "text", sql: `t.number` },
      ...common,
      { key: "status", label: "Status", type: "enum", sql: `t.status`, options: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] },
      { key: "subtotal", label: "Subtotal", type: "money", sql: `t.subtotal` },
      { key: "discountTotal", label: "Discount given", type: "money", sql: `t."discountTotal"` },
      { key: "discountPct", label: "Discount %", type: "percent", sql: `CASE WHEN t.subtotal > 0 THEN round(t."discountTotal" * 100 / t.subtotal, 2) ELSE 0 END` },
      { key: "total", label: "Total", type: "money", sql: `t.total` },
      { key: "issueDate", label: "Issue date", type: "date", sql: `t."issueDate"` },
      { key: "validUntil", label: "Valid until", type: "date", sql: `t."validUntil"` },
      { key: "ageDays", label: "Age (days)", type: "number", sql: `((now() AT TIME ZONE 'Africa/Lagos')::date - t."issueDate")` },
      {
        key: "ageBucket",
        label: "Age",
        type: "text",
        sql: `CASE WHEN (now() AT TIME ZONE 'Africa/Lagos')::date - t."issueDate" <= 7 THEN '0-7 days' WHEN (now() AT TIME ZONE 'Africa/Lagos')::date - t."issueDate" <= 14 THEN '8-14 days' WHEN (now() AT TIME ZONE 'Africa/Lagos')::date - t."issueDate" <= 30 THEN '15-30 days' ELSE 'over 30 days' END`,
      },
      {
        key: "approvalState",
        label: "Discount approval",
        type: "text",
        sql: `CASE WHEN t."discountTotal" = 0 THEN 'No discount'
                   WHEN EXISTS (SELECT 1 FROM "ApprovalRequest" ar WHERE ar.entity = 'Quote' AND ar."entityId" = t.id AND ar.kind = 'DISCOUNT' AND ar.status = 'APPROVED' AND ar."deletedAt" IS NULL) THEN 'Approved by manager'
                   WHEN EXISTS (SELECT 1 FROM "ApprovalRequest" ar WHERE ar.entity = 'Quote' AND ar."entityId" = t.id AND ar.kind = 'DISCOUNT' AND ar.status = 'PENDING' AND ar."deletedAt" IS NULL) THEN 'Waiting for approval'
                   WHEN EXISTS (SELECT 1 FROM "ApprovalRequest" ar WHERE ar.entity = 'Quote' AND ar."entityId" = t.id AND ar.kind = 'DISCOUNT' AND ar.status = 'REJECTED' AND ar."deletedAt" IS NULL) THEN 'Rejected'
                   ELSE 'Within the limit' END`,
      },
      { key: "deal", label: "Deal", type: "text", sql: `d.name`, joins: ["deal"] },
      { key: "account", label: "Account", type: "text", sql: `a.name`, joins: ["account"] },
    ],
  },
  {
    key: "activities",
    label: "Activities",
    table: `"Activity"`,
    path: "/activities",
    defaultSort: "createdAt",
    joins: { ...baseJoins },
    defaultColumns: ["subject", "type", "status", "brand", "owner", "when"],
    fields: [
      { key: "subject", label: "Subject", type: "text", sql: `t.subject` },
      ...common,
      { key: "type", label: "Type", type: "enum", sql: `t.type`, options: ["TASK", "CALL", "MEETING", "TEST_DRIVE", "EMAIL_LOG", "WHATSAPP_LOG", "SMS_LOG"] },
      { key: "status", label: "Status", type: "enum", sql: `t.status`, options: ["OPEN", "COMPLETED", "CANCELLED", "NO_SHOW"] },
      { key: "priority", label: "Priority", type: "enum", sql: `t.priority`, options: ["LOW", "NORMAL", "HIGH"] },
      { key: "parentType", label: "Related to", type: "text", sql: `t."parentType"` },
      { key: "when", label: "Due / start", type: "date", sql: `coalesce(t."startAt", t."dueAt")` },
      { key: "completedAt", label: "Closed on", type: "date", sql: `t."completedAt"` },
      { key: "durationSec", label: "Call duration (s)", type: "number", sql: `t."durationSec"` },
    ],
  },
  {
    key: "cases",
    label: "Cases",
    table: `"Case"`,
    path: "/cases",
    defaultSort: "createdAt",
    joins: { ...baseJoins, account: `LEFT JOIN "Account" a ON a.id = t."accountId"`, deal: `LEFT JOIN "Deal" d ON d.id = t."dealId"` },
    defaultColumns: ["number", "subject", "brand", "type", "priority", "status", "owner", "createdAt"],
    fields: [
      { key: "number", label: "Case no.", type: "text", sql: `t.number` },
      { key: "subject", label: "Subject", type: "text", sql: `t.subject` },
      ...common,
      { key: "type", label: "Type", type: "enum", sql: `t.type`, options: ["COMPLAINT", "ENQUIRY", "DELIVERY_ISSUE", "WARRANTY", "DOCUMENTATION", "BILLING"] },
      { key: "priority", label: "Priority", type: "enum", sql: `t.priority`, options: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
      { key: "channel", label: "Channel", type: "enum", sql: `t.channel`, options: ["PHONE", "EMAIL", "WHATSAPP", "WALK_IN", "WEB"] },
      { key: "status", label: "Status", type: "enum", sql: `t.status`, options: ["NEW", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED"] },
      { key: "slaDueAt", label: "Resolution due", type: "date", sql: `t."slaDueAt"` },
      { key: "resolvedAt", label: "Resolved on", type: "date", sql: `t."resolvedAt"` },
      {
        key: "slaOutcome",
        label: "SLA outcome",
        type: "text",
        sql: `CASE WHEN t."slaDueAt" IS NULL THEN 'No SLA'
                   WHEN t."resolvedAt" IS NOT NULL AND t."resolvedAt" <= t."slaDueAt" THEN 'Resolved within SLA'
                   WHEN t."resolvedAt" IS NOT NULL THEN 'Resolved late'
                   WHEN t."slaDueAt" < (now() AT TIME ZONE 'UTC') THEN 'Open - overdue'
                   ELSE 'Open - on time' END`,
      },
      { key: "hoursToResolve", label: "Hours to resolve", type: "number", sql: `round((extract(epoch FROM (t."resolvedAt" - t."createdAt")) / 3600)::numeric, 1)` },
      { key: "escalated", label: "Escalated", type: "text", sql: `CASE WHEN t."escalatedAt" IS NULL THEN 'No' ELSE 'Yes' END` },
      { key: "satisfactionScore", label: "Satisfaction (1-5)", type: "number", sql: `t."satisfactionScore"` },
      { key: "account", label: "Account", type: "text", sql: `a.name`, joins: ["account"] },
      { key: "deal", label: "Deal", type: "text", sql: `d.name`, joins: ["deal"] },
      { key: "vin", label: "VIN", type: "text", sql: `t.vin` },
    ],
  },
];

export const reportModule = (key: string) => REPORT_MODULES.find((m) => m.key === key);
export const reportField = (m: RModule, key: string) => m.fields.find((f) => f.key === key);
export const isNumeric = (f: RField) => f.type === "number" || f.type === "money" || f.type === "percent";

export const GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const SUMMARY_FNS = ["count", "sum", "avg", "min", "max"] as const;
export const CHART_TYPES = ["none", "bar", "line", "pie", "funnel"] as const;
export const FILTER_OPS = ["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "isEmpty", "notEmpty"] as const;
export const DATE_PRESETS = ["ALL", "THIS_MONTH", "LAST_MONTH", "THIS_QUARTER", "LAST_QUARTER", "THIS_YEAR", "LAST_YEAR", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "CUSTOM"] as const;
export const PRESET_LABELS: Record<(typeof DATE_PRESETS)[number], string> = {
  ALL: "All time",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  THIS_QUARTER: "This quarter",
  LAST_QUARTER: "Last quarter",
  THIS_YEAR: "This year",
  LAST_YEAR: "Last year",
  LAST_7_DAYS: "Last 7 days",
  LAST_30_DAYS: "Last 30 days",
  LAST_90_DAYS: "Last 90 days",
  CUSTOM: "Custom range",
};
export const SPECIALS = ["FUNNEL", "LEAD_SOURCE_ROI", "EXEC_PERFORMANCE"] as const;
