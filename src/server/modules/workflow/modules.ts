/**
 * Module schemas for workflow rules: the fields a rule may use in criteria, as a trigger field, or update.
 * Pure data – shared by the rule builder UI, validation and the engine.
 */
import type { Op, WhereField } from "@/server/automation/criteria";

export interface WfField extends WhereField {
  key: string;
  label: string;
  options?: string[];
  /** may be set by a FIELD_UPDATE action */
  updatable?: boolean;
  /** can be watched by a FIELD_CHANGE trigger (a real column) */
  watchable?: boolean;
}

export interface WfModule {
  key: "leads" | "deals" | "quotes" | "salesOrders";
  label: string;
  model: "Lead" | "Deal" | "Quote" | "SalesOrder";
  fields: WfField[];
}

const created: WfField = { key: "createdAt", label: "Created", type: "date" };
const updated: WfField = { key: "updatedAt", label: "Last updated", type: "date" };
const owner: WfField = { key: "ownerId", label: "Owner (user id)", type: "text", watchable: true };
const boolWhere = (yes: Record<string, unknown>) => (op: Op, value: unknown) => {
  if (op !== "eq" && op !== "neq") return null;
  const want = (value === true || value === "true") === (op === "eq");
  return want ? yes : { NOT: yes };
};

export const WF_MODULES: WfModule[] = [
  {
    key: "leads",
    label: "Leads",
    model: "Lead",
    fields: [
      { key: "status", label: "Status", type: "enum", options: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"], watchable: true },
      { key: "rating", label: "Rating", type: "enum", options: ["HOT", "WARM", "COLD"], updatable: true, watchable: true },
      { key: "source", label: "Source", type: "enum", options: ["WALK_IN", "WEBSITE", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "REFERRAL", "FLEET_CORPORATE", "EVENT", "PHONE"] },
      { key: "city", label: "City", type: "text" },
      { key: "budget", label: "Budget", type: "number" },
      { key: "tradeIn", label: "Trade-in", type: "boolean" },
      owner,
      created,
      updated,
    ],
  },
  {
    key: "deals",
    label: "Deals",
    model: "Deal",
    fields: [
      { key: "stageId", label: "Stage (any change)", type: "text", watchable: true },
      {
        key: "stageType",
        label: "Stage type",
        type: "enum",
        options: ["OPEN", "WON", "LOST"],
        where: (op, value) => (op === "eq" ? { stage: { type: value } } : op === "neq" ? { NOT: { stage: { type: value } } } : null),
      },
      { key: "stageKey", label: "Stage key", type: "text", where: (op, value) => (op === "eq" ? { stage: { key: value } } : op === "neq" ? { NOT: { stage: { key: value } } } : null) },
      { key: "isOpen", label: "Is open", type: "boolean", where: boolWhere({ stage: { type: "OPEN" } }) },
      { key: "amount", label: "Amount", type: "number", watchable: true },
      { key: "discountPct", label: "Discount %", type: "number", watchable: true },
      { key: "paymentType", label: "Payment type", type: "enum", options: ["CASH", "BANK_FINANCE", "LEASE", "FLEET"], watchable: true },
      { key: "closeDate", label: "Expected close", type: "date", updatable: true, watchable: true },
      { key: "deliveryDate", label: "Delivery date", type: "date", watchable: true },
      owner,
      created,
      updated,
    ],
  },
  {
    key: "quotes",
    label: "Quotes",
    model: "Quote",
    fields: [
      { key: "status", label: "Status", type: "enum", options: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"], watchable: true },
      { key: "total", label: "Total", type: "number" },
      { key: "validUntil", label: "Valid until", type: "date" },
      owner,
      created,
      updated,
    ],
  },
  {
    key: "salesOrders",
    label: "Sales Orders",
    model: "SalesOrder",
    fields: [
      { key: "status", label: "Status", type: "enum", options: ["DRAFT", "CONFIRMED", "ALLOCATED", "DELIVERED", "CANCELLED"], watchable: true },
      { key: "total", label: "Total", type: "number" },
      owner,
      created,
      updated,
    ],
  },
];

export const wfModule = (key: string) => WF_MODULES.find((m) => m.key === key);
export const wfModuleByModel = (model: string) => WF_MODULES.find((m) => m.model === model);
export const fieldMap = (m: WfModule): Record<string, WfField> => Object.fromEntries(m.fields.map((f) => [f.key, f]));

export const TRIGGER_LABELS: Record<string, string> = {
  ON_CREATE: "When a record is created",
  ON_EDIT: "When a record is edited",
  FIELD_CHANGE: "When a field changes",
  DATE_BASED: "On a date of the record",
  SCHEDULED: "Scheduled check (records matching the criteria)",
};
export const ACTION_LABELS: Record<string, string> = {
  FIELD_UPDATE: "Update a field",
  CREATE_TASK: "Create a task",
  SEND_NOTIFICATION: "Send a notification",
  SEND_EMAIL: "Send an email",
  WEBHOOK: "Call a webhook",
  ASSIGN_OWNER: "Assign owner",
  CALL_FUNCTION: "Call a function",
};
export const RECIPIENTS = ["OWNER", "BRAND_MANAGER", "ROLE"] as const;
export const FUNCTIONS = [{ name: "copyBrandFromDeal", label: "Copy brand and region from the deal (quotes, sales orders)" }] as const;
