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

export const lineSchema = z.object({
  productId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  description: z.string().trim().min(1, "Description is required").max(300),
  qty: z.coerce.number().positive().max(100_000),
  unitPrice: z.coerce.number().nonnegative().max(1e12),
  discountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 0),
  taxRate: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 7.5),
  vin: z.preprocess(empty, z.string().trim().toUpperCase().max(40).optional()).transform((v) => v ?? null),
});
export type LineData = z.infer<typeof lineSchema>;

export const saveSchema = z.object({
  lines: z.array(lineSchema).max(100),
  headerDiscountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 0),
  date: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null),
  terms: z.preprocess(empty, z.string().trim().max(4000).optional()).transform((v) => v ?? null),
  notes: z.preprocess(empty, z.string().trim().max(4000).optional()).transform((v) => v ?? null),
  priceBookId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
});
export type SaveInput = z.input<typeof saveSchema>;

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE", "FINANCE"] as const;
export const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e12),
  method: z.enum(PAYMENT_METHODS),
  reference: z.preprocess(empty, z.string().trim().max(100).optional()).transform((v) => v ?? null),
  receivedAt: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? new Date()),
});
