import { z } from "zod";
import type { ModuleKey } from "@/server/access/modules";

/** The three sales documents share one implementation; this is what differs. */
export const DOC_TYPES = ["quote", "salesOrder", "invoice"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocConfig {
  type: DocType;
  /** Prisma model + delegate */
  model: "Quote" | "SalesOrder" | "Invoice";
  module: ModuleKey;
  /** route segment: /quotes, /salesOrders, /invoices */
  path: string;
  label: string;
  plural: string;
  /** the type-specific date column */
  dateField: "validUntil" | "expectedDelivery" | "dueDate";
  dateLabel: string;
  /** line foreign key */
  lineKey: "quoteId" | "salesOrderId" | "invoiceId";
  /** statuses in which lines and header can be edited */
  editable: string[];
  statuses: Record<string, string>;
}

export const DOCS: Record<DocType, DocConfig> = {
  quote: {
    type: "quote",
    model: "Quote",
    module: "quotes",
    path: "/quotes",
    label: "Quote",
    plural: "Quotes",
    dateField: "validUntil",
    dateLabel: "Valid until",
    lineKey: "quoteId",
    editable: ["DRAFT"],
    statuses: { DRAFT: "Draft", PENDING_APPROVAL: "Pending Approval", APPROVED: "Approved", SENT: "Sent", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Expired" },
  },
  salesOrder: {
    type: "salesOrder",
    model: "SalesOrder",
    module: "salesOrders",
    path: "/salesOrders",
    label: "Sales Order",
    plural: "Sales Orders",
    dateField: "expectedDelivery",
    dateLabel: "Expected delivery",
    lineKey: "salesOrderId",
    editable: ["DRAFT"],
    statuses: { DRAFT: "Draft", CONFIRMED: "Confirmed", ALLOCATED: "Allocated", DELIVERED: "Delivered", CANCELLED: "Cancelled" },
  },
  invoice: {
    type: "invoice",
    model: "Invoice",
    module: "invoices",
    path: "/invoices",
    label: "Invoice",
    plural: "Invoices",
    dateField: "dueDate",
    dateLabel: "Due date",
    lineKey: "invoiceId",
    editable: ["DRAFT"],
    statuses: { DRAFT: "Draft", ISSUED: "Issued", PART_PAID: "Part-paid", PAID: "Paid", VOID: "Void" },
  },
};

export const docByPath = (segment: string): DocConfig | undefined => Object.values(DOCS).find((d) => d.path === `/${segment}`);

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * A document line: a product of the document's brand, OR a free-text item (prompt 23). For a free-text line the
 * description is the item name and the price is typed; for a product line a missing price is taken from the brand's
 * price book when the document is created.
 */
export const lineSchema = z.object({
  productId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  description: z.string().trim().min(1, "Give each line an item name").max(300),
  itemCode: z.preprocess(empty, z.string().trim().max(60).optional()).transform((v) => v ?? null),
  /** free text under the item name (prompt 24) */
  details: z.preprocess(empty, z.string().trim().max(2000).optional()).transform((v) => v ?? null),
  uom: z.preprocess(empty, z.string().trim().max(20).optional()).transform((v) => v ?? null),
  isStockItem: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  qty: z.coerce.number().positive().max(100_000),
  unitPrice: z.coerce.number().nonnegative().max(1e12),
  discountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 0),
  taxRate: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 7.5),
  vin: z.preprocess(empty, z.string().trim().toUpperCase().max(40).optional()).transform((v) => v ?? null),
  // ── Ordered Items grid (prompt 24); without them the legacy discountPct / taxRate are used ──
  /** an existing line's id: the line is kept (its change history continues) */
  id: z.preprocess(empty, z.string().max(40).optional()),
  discountType: z.enum(["PERCENT", "AMOUNT"]).optional(),
  discountValue: z.preprocess(empty, z.coerce.number().min(0).max(1e13).optional()),
  taxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).optional(),
  /** one VIN per unit (vehicle lines); `vin` stays the first one */
  vins: z.array(z.string().trim().toUpperCase().min(5).max(40)).max(500).optional(),
});
export type LineData = z.infer<typeof lineSchema>;
export const MAX_LINES = 200;

const headerFields = {
  headerDiscountType: z.enum(["PERCENT", "AMOUNT"]).optional(),
  headerDiscountValue: z.preprocess(empty, z.coerce.number().min(0).max(1e13).optional()),
  documentTaxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).optional(),
  adjustment: z.preprocess(empty, z.coerce.number().min(-1e12).max(1e12).optional()),
};

export const saveSchema = z.object({
  lines: z.array(lineSchema).max(200, "At most 200 lines per document"),
  headerDiscountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 0),
  ...headerFields,
  date: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null),
  terms: z.preprocess(empty, z.string().trim().max(4000).optional()).transform((v) => v ?? null),
  notes: z.preprocess(empty, z.string().trim().max(4000).optional()).transform((v) => v ?? null),
  priceBookId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
});
export type SaveInput = z.input<typeof saveSchema>;

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE", "FINANCE", "ONLINE"] as const;
export const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e12),
  method: z.enum(PAYMENT_METHODS),
  reference: z.preprocess(empty, z.string().trim().max(100).optional()).transform((v) => v ?? null),
  receivedAt: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? new Date()),
});

// ───────────────────────────── standalone creation (prompt 23) ─────────────────────────────

const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional()).transform((v) => v ?? null);

/** The customer as the document shows it – complete without any account (`billTo` / `shipTo`). */
export const partySchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name").max(200),
  company: text(200),
  phone: text(40),
  email: z.preprocess(empty, z.string().trim().toLowerCase().email("Enter a valid e-mail address").max(254).optional()).transform((v) => v ?? null),
  address: text(400),
  city: text(80),
  state: text(80),
  taxId: text(40),
});
export type Party = z.output<typeof partySchema>;

/** A line on create: the price may be left out for a product line (taken from the price book). */
export const createLineSchema = lineSchema.extend({
  unitPrice: z.preprocess(empty, z.coerce.number().nonnegative().max(1e12).optional()),
  taxRate: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()),
});

export const createSchema = z.object({
  /** brand and region: required, but filled from the user's only brand / their region when left out */
  brandId: z.preprocess(empty, z.string().optional()),
  regionId: z.preprocess(empty, z.string().optional()),
  billTo: partySchema,
  shipTo: partySchema.partial().nullish(),
  lines: z.array(createLineSchema).min(1, "Add at least one line").max(200, "At most 200 lines per document"),
  headerDiscountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 0),
  ...headerFields,
  /** invoice: invoice date (defaults to today); every type: its own date (valid until / delivery / due) */
  issueDate: z.preprocess(empty, z.coerce.date().optional()),
  date: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null),
  /** the type's own date under its own name (record templates): validUntil / expectedDelivery / dueDate */
  validUntil: z.preprocess(empty, z.coerce.date().optional()),
  expectedDelivery: z.preprocess(empty, z.coerce.date().optional()),
  dueDate: z.preprocess(empty, z.coerce.date().optional()),
  currency: z.preprocess(empty, z.string().trim().length(3).optional()),
  terms: text(4000),
  notes: text(4000),
  // ── optional links (same brand; checked on the server) ──
  dealId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  accountId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  contactId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  /** sales order: its quote; invoice: its quote or sales order */
  sourceDocumentId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  priceBookId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  ownerId: z.preprocess(empty, z.string().optional()),
});
export type CreateDocumentInput = z.input<typeof createSchema>;

/** Link later: any of these, or null to remove the link. */
export const linkSchema = z.object({
  dealId: z.string().min(1).nullish(),
  accountId: z.string().min(1).nullish(),
  contactId: z.string().min(1).nullish(),
  sourceDocumentId: z.string().min(1).nullish(),
  /** take the bill-to snapshot from the linked account / contact */
  refreshBillTo: z.boolean().default(false),
});
export type LinkInput = z.input<typeof linkSchema>;

/** Dependency rules per brand (Setup → Modules and Fields → Dependencies). Everything optional by default. */
export const DOCUMENT_RULES = {
  requireAccount: "Require an account on quotes, sales orders and invoices",
  requireContact: "Require a contact on quotes, sales orders and invoices",
  requireDeal: "Require a deal on quotes, sales orders and invoices",
  requireProduct: "Require a product on every line (no free-text items)",
  requireQuoteBeforeOrder: "Require a quote before a sales order",
  requireOrderBeforeInvoice: "Require a sales order before an invoice",
  requireStockLinkForVehicleInvoice: "Require vehicle lines to be linked to a stock unit before an invoice is issued",
} as const;
export type DocumentRule = keyof typeof DOCUMENT_RULES;
export const documentRulesSchema = z.object({
  ...(Object.fromEntries(Object.keys(DOCUMENT_RULES).map((k) => [k, z.boolean().default(false)])) as Record<DocumentRule, z.ZodDefault<z.ZodBoolean>>),
  /** discounts on documents with free-text lines (no price book maximum): approval above this amount, 0 = off */
  discountAmountApproval: z.coerce.number().min(0).max(1e13).default(0),
  // ── Ordered Items (prompt 24) ──
  /** taxes offered in the grid; the first is applied to new lines */
  taxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).default([{ name: "VAT", rate: 7.5 }]),
  /** LINE: each line carries its taxes; DOCUMENT: taxes are applied once on the document */
  taxMode: z.enum(["LINE", "DOCUMENT"]).default("LINE"),
  roundingMode: z.enum(["HALF_UP", "HALF_EVEN"]).default("HALF_UP"),
  /** who may enter an adjustment: everyone who edits the document, or managers (brand manager / admin) only */
  adjustmentManagersOnly: z.boolean().default(false),
});
export type DocumentRules = z.output<typeof documentRulesSchema>;
export const parseRules = (raw: unknown): DocumentRules => documentRulesSchema.parse(raw && typeof raw === "object" ? raw : {});
