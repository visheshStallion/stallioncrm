import { z } from "zod";

export const CASE_TYPES = ["COMPLAINT", "ENQUIRY", "DELIVERY_ISSUE", "WARRANTY", "DOCUMENTATION", "BILLING"] as const;
export const TYPE_LABELS: Record<(typeof CASE_TYPES)[number], string> = {
  COMPLAINT: "Complaint",
  ENQUIRY: "Enquiry",
  DELIVERY_ISSUE: "Delivery issue",
  WARRANTY: "Warranty",
  DOCUMENTATION: "Documentation / Registration",
  BILLING: "Billing",
};
export const CASE_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PRIORITY_LABELS: Record<(typeof CASE_PRIORITIES)[number], string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const CASE_CHANNELS = ["PHONE", "EMAIL", "WHATSAPP", "WALK_IN", "WEB"] as const;
export const CHANNEL_LABELS: Record<(typeof CASE_CHANNELS)[number], string> = { PHONE: "Phone", EMAIL: "Email", WHATSAPP: "WhatsApp", WALK_IN: "Walk-in", WEB: "Web" };
export const CASE_STATUSES = ["NEW", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export type CaseStatusKey = (typeof CASE_STATUSES)[number];
export const STATUS_LABELS: Record<CaseStatusKey, string> = { NEW: "New", IN_PROGRESS: "In progress", WAITING_ON_CUSTOMER: "Waiting on customer", ESCALATED: "Escalated", RESOLVED: "Resolved", CLOSED: "Closed" };
export const OPEN_STATUSES: CaseStatusKey[] = ["NEW", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "ESCALATED"];

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional()).transform((v) => v ?? null);
const id = z.preprocess(empty, z.string().max(40).optional()).transform((v) => v ?? null);

const fields = {
  subject: z.string().trim().min(1, "Subject is required").max(200),
  description: text(5000),
  type: z.preprocess(empty, z.enum(CASE_TYPES).optional()).transform((v) => v ?? "ENQUIRY"),
  priority: z.preprocess(empty, z.enum(CASE_PRIORITIES).optional()).transform((v) => v ?? "MEDIUM"),
  channel: z.preprocess(empty, z.enum(CASE_CHANNELS).optional()).transform((v) => v ?? "PHONE"),
  accountId: id,
  contactId: id,
  dealId: id,
  salesOrderId: id,
  vin: z.preprocess(empty, z.string().trim().toUpperCase().max(40).optional()).transform((v) => v ?? null),
  customerName: text(160),
  customerPhone: text(40),
  customerEmail: z.preprocess(empty, z.string().trim().toLowerCase().email().max(254).optional()).transform((v) => v ?? null),
};

export const createCaseSchema = z.object({
  ...fields,
  /** brand and region: taken from the deal when one is linked, otherwise required */
  brandId: z.preprocess(empty, z.string().optional()),
  regionId: z.preprocess(empty, z.string().optional()),
  ownerId: z.preprocess(empty, z.string().optional()),
});
export type CreateCaseInput = z.input<typeof createCaseSchema>;

export const updateCaseSchema = z.object(fields).partial();
export type UpdateCaseInput = z.input<typeof updateCaseSchema>;

export const statusSchema = z.object({
  status: z.enum(CASE_STATUSES),
  resolution: text(4000),
});

export const slaSchema = z.object({
  firstResponseHours: z.coerce.number().int().min(1).max(720),
  resolutionHours: z.coerce.number().int().min(1).max(2160),
  escalateToRole: z.string().trim().min(1).max(80).default("Brand Manager"),
});

export const solutionSchema = z.object({
  brandId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "The article text is required").max(20_000),
  tags: z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []), z.array(z.string().trim().toLowerCase().max(40)).max(15)).transform((t) => [...new Set(t.filter(Boolean))]),
  published: z.boolean().default(false),
});

/** Public case form (web / email-to-case gateway). The brand comes from the URL. */
export const publicCaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: text(40),
  email: z.preprocess(empty, z.string().trim().toLowerCase().email().max(254).optional()).transform((v) => v ?? null),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  type: z.preprocess(empty, z.enum(CASE_TYPES).optional()).transform((v) => v ?? "ENQUIRY"),
  region: text(80),
  vin: text(40),
  /** honeypot */
  website: z.string().max(200).optional(),
});
