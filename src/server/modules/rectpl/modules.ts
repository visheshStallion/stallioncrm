/**
 * Modules that support record templates (prompt 22 §3) and the fields a template may pre-fill.
 *
 * The fields are read from the module's own CREATE SCHEMA (zod) – a template can hold exactly what the create service
 * accepts, nothing else – and a record is always created by the module's own create service, with the user's access.
 * Quotes, sales orders and invoices can be created standalone (prompt 23), so they have record templates too: terms,
 * notes, dates, header discount and line items (priced from the current price book). Purchase orders are not here.
 */
import "server-only";
import { z } from "zod";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";

export type FieldType = "text" | "number" | "bool" | "date" | "select" | "ref";
export interface TemplateField {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
}

export interface RtModule {
  key: string;
  label: string;
  plural: string;
  permission: ModuleKey;
  /** the create page; `?template=<id>` pre-fills it */
  newHref: string;
  recordHref: (id: string) => string;
  /** parent type of activities (child tasks of a template), when records of the module can have them */
  parentType: "Lead" | "Deal" | "Case" | "Account" | "Contact" | null;
  /** Prisma delegate, to read a record for "Save record as template" */
  delegate: string;
  schema: () => Promise<z.ZodTypeAny>;
  /** fields that are never part of a template (identity of one customer or one record) */
  personal: string[];
  /** documents (quotes, sales orders, invoices): created through the documents service with a bill-to */
  document?: "quote" | "salesOrder" | "invoice";
  hasLines?: boolean;
  create: (ctx: AccessContext, input: Record<string, unknown>) => Promise<{ id: string }>;
}

const PERSON = ["firstName", "lastName", "name", "mobile", "phone", "email", "address", "customerName", "customerPhone", "customerEmail", "accountId", "contactId", "dealId", "salesOrderId", "vin", "vinChassisNo", "engineNo", "depositReceiptNo", "rcNumber", "website", "parentId", "participants", "dob"];

export const RT_MODULES: RtModule[] = [
  {
    key: "leads",
    label: "Lead",
    plural: "Leads",
    permission: "leads",
    newHref: "/leads/new",
    recordHref: (id) => `/leads/${id}`,
    parentType: "Lead",
    delegate: "lead",
    schema: async () => (await import("@/server/modules/leads/schema")).createLeadSchema,
    personal: PERSON,
    create: async (ctx, input) => (await import("@/server/modules/leads/service")).createLead(ctx, input as never, { autoAssign: false }),
  },
  {
    key: "deals",
    label: "Deal",
    plural: "Deals",
    permission: "deals",
    newHref: "/deals/new",
    recordHref: (id) => `/deals/${id}`,
    parentType: "Deal",
    delegate: "deal",
    schema: async () => (await import("@/server/modules/deals/schema")).createDealSchema,
    personal: PERSON,
    create: async (ctx, input) => (await import("@/server/modules/deals/service")).createDeal(ctx, input as never),
  },
  {
    key: "cases",
    label: "Case",
    plural: "Cases",
    permission: "cases",
    newHref: "/cases/new",
    recordHref: (id) => `/cases/${id}`,
    parentType: "Case",
    delegate: "case",
    schema: async () => (await import("@/server/modules/cases/schema")).createCaseSchema,
    personal: PERSON,
    create: async (ctx, input) => (await import("@/server/modules/cases/service")).createCase(ctx, input as never),
  },
  {
    key: "accounts",
    label: "Account",
    plural: "Accounts",
    permission: "accounts",
    newHref: "/accounts/new",
    recordHref: (id) => `/accounts/${id}`,
    parentType: "Account",
    delegate: "account",
    schema: async () => (await import("@/server/modules/customers/schema")).accountSchema,
    personal: PERSON,
    create: async (ctx, input) => (await import("@/server/modules/customers/service")).createAccount(ctx, input as never),
  },
  {
    key: "contacts",
    label: "Contact",
    plural: "Contacts",
    permission: "contacts",
    newHref: "/contacts/new",
    recordHref: (id) => `/contacts/${id}`,
    parentType: "Contact",
    delegate: "contact",
    schema: async () => (await import("@/server/modules/customers/schema")).contactSchema,
    personal: PERSON,
    create: async (ctx, input) => (await import("@/server/modules/customers/service")).createContact(ctx, input as never),
  },
  {
    key: "quotes",
    label: "Quotation",
    plural: "Quotes",
    permission: "quotes",
    newHref: "/quotes/new",
    recordHref: (id) => `/quotes/${id}`,
    parentType: null,
    delegate: "quote",
    // standalone documents (prompt 23): a template adds terms, notes, the date, a header discount and line items
    schema: async () => z.object({ terms: z.string().max(5000).optional(), notes: z.string().max(2000).optional(), validUntil: z.coerce.date().optional(), headerDiscountPct: z.coerce.number().min(0).max(100).optional() }),
    personal: [],
    document: "quote",
    hasLines: true,
    create: async () => {
      throw new Error("documents are created by createDocumentFromTemplate");
    },
  },
  {
    key: "salesOrders",
    label: "Sales Order",
    plural: "Sales Orders",
    permission: "salesOrders",
    newHref: "/salesOrders/new",
    recordHref: (id) => `/salesOrders/${id}`,
    parentType: null,
    delegate: "salesOrder",
    // standalone documents (prompt 23): a template adds terms, notes, the date, a header discount and line items
    schema: async () => z.object({ terms: z.string().max(5000).optional(), notes: z.string().max(2000).optional(), expectedDelivery: z.coerce.date().optional(), headerDiscountPct: z.coerce.number().min(0).max(100).optional() }),
    personal: [],
    document: "salesOrder",
    hasLines: true,
    create: async () => {
      throw new Error("documents are created by createDocumentFromTemplate");
    },
  },
  {
    key: "invoices",
    label: "Invoice",
    plural: "Invoices",
    permission: "invoices",
    newHref: "/invoices/new",
    recordHref: (id) => `/invoices/${id}`,
    parentType: null,
    delegate: "invoice",
    // standalone documents (prompt 23): a template adds terms, notes, the date, a header discount and line items
    schema: async () => z.object({ terms: z.string().max(5000).optional(), notes: z.string().max(2000).optional(), dueDate: z.coerce.date().optional(), headerDiscountPct: z.coerce.number().min(0).max(100).optional() }),
    personal: [],
    document: "invoice",
    hasLines: true,
    create: async () => {
      throw new Error("documents are created by createDocumentFromTemplate");
    },
  },
];

export const rtModule = (key: string) => RT_MODULES.find((m) => m.key === key);
export const RT_MODULE_OPTIONS = RT_MODULES.map((m) => ({ key: m.key, label: m.label, plural: m.plural }));

// ───────────────────────────── fields from the create schema ─────────────────────────────

const humanize = (key: string) => {
  const words = key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/\bvin\b/i, "VIN").replace(/\bkyc\b/i, "KYC").replace(/\bpct\b/i, "%");
};

/** Strips effects, optional, nullable and defaults to reach the type that decides how a value is entered. */
function base(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur = t;
  for (let i = 0; i < 12; i++) {
    const def = cur._def as { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny; in?: z.ZodTypeAny; out?: z.ZodTypeAny };
    const next = def.schema ?? def.innerType ?? def.out ?? def.in;
    if (!next) break;
    cur = next;
  }
  return cur;
}

function objectOf(t: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | null {
  const b = base(t);
  return b instanceof z.ZodObject ? (b as z.ZodObject<z.ZodRawShape>) : null;
}

const SKIP = new Set(["customFields", "parentType", "parentId", "participants", "recurrence", "reminderAt", "unqualifiedReason", "lossReason", "lossCompetitorBrand"]);

/** The fields a template of the module may hold, with how each is entered. */
export async function templateFields(mod: RtModule): Promise<TemplateField[]> {
  const shape = objectOf(await mod.schema())?.shape ?? {};
  return Object.entries(shape)
    .filter(([name]) => !SKIP.has(name))
    .map(([name, t]): TemplateField => {
      const b = base(t as z.ZodTypeAny);
      if (b instanceof z.ZodEnum) return { name, label: humanize(name), type: "select", options: [...(b.options as string[])] };
      if (b instanceof z.ZodNumber) return { name, label: humanize(name), type: "number" };
      if (b instanceof z.ZodBoolean) return { name, label: humanize(name), type: "bool" };
      if (b instanceof z.ZodDate) return { name, label: humanize(name), type: "date" };
      return { name, label: humanize(name), type: /Id$/.test(name) ? "ref" : "text" };
    });
}
