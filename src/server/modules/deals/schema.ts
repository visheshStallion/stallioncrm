import { z } from "zod";
import { PAYMENT_INTENTS } from "@/server/modules/leads/schema";

/** Keys / names of the default pipeline stages (pipelines are per brand and configurable – prefer the DB values). */
export const DEFAULT_STAGE_KEYS = ["ENQUIRY", "TEST_DRIVE", "QUOTATION", "BOOKING", "FINANCE_PAYMENT", "DELIVERY", "CLOSED_WON", "CLOSED_LOST"] as const;
export const STAGE_LABELS: Record<string, string> = {
  ENQUIRY: "Enquiry",
  TEST_DRIVE: "Test Drive",
  QUOTATION: "Quotation",
  BOOKING: "Booking",
  FINANCE_PAYMENT: "Finance / Payment",
  DELIVERY: "Delivery",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
};

export const CURRENCIES = ["NGN", "USD"] as const;

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const optId = z.preprocess(empty, z.string().optional()).transform((v) => v ?? null);
const optNum = (max: number) => z.preprocess(empty, z.coerce.number().nonnegative().max(max).optional()).transform((v) => v ?? null);
const optDate = z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null);

/** Fields editable on a deal (brand / region / stage / owner have their own rules). */
export const dealFieldsSchema = z.object({
  name: z.string().trim().min(1, "Deal name is required").max(200),
  customerName: text(200),
  accountId: optId,
  contactId: optId,
  amount: optNum(1e12),
  currency: z.enum(CURRENCIES).default("NGN"),
  closeDate: optDate,
  modelId: optId,
  quantity: z.preprocess(empty, z.coerce.number().int().min(1).max(10_000).optional()).transform((v) => v ?? 1),
  colour: text(60),
  paymentType: z.preprocess(empty, z.enum(PAYMENT_INTENTS).optional()).transform((v) => v ?? null),
  financeBank: text(100),
  tradeInDetails: text(500),
  discountPct: optNum(100),
  testDriveDate: optDate,
  depositAmount: optNum(1e12),
  depositReceiptNo: text(60),
  vinChassisNo: z.preprocess(empty, z.string().trim().toUpperCase().max(40).optional()).transform((v) => v ?? null),
  engineNo: text(60),
  deliveryDate: optDate,
  lossReason: text(300),
  lossCompetitorBrand: text(100),
});

export const createDealSchema = dealFieldsSchema.extend({
  brandId: z.string().min(1, "Brand is required"),
  regionId: z.string().min(1, "Region is required"),
  ownerId: z.preprocess(empty, z.string().optional()),
  pipelineId: z.preprocess(empty, z.string().optional()),
});
export type CreateDealInput = z.input<typeof createDealSchema>;

export const updateDealSchema = dealFieldsSchema.partial();
export type UpdateDealInput = z.input<typeof updateDealSchema>;
export const DEAL_FIELD_KEYS = Object.keys(dealFieldsSchema.shape);
