import { z } from "zod";

export const CATEGORIES = ["VEHICLE", "ACCESSORY", "PART", "EXTENDED_WARRANTY", "SERVICE_PACKAGE", "INSURANCE"] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  VEHICLE: "Vehicle",
  ACCESSORY: "Accessory",
  PART: "Spare part",
  EXTENDED_WARRANTY: "Extended Warranty",
  SERVICE_PACKAGE: "Service Package",
  INSURANCE: "Insurance",
};
export const STOCK_STATUSES = ["IN_TRANSIT", "IN_STOCK", "RESERVED", "SOLD"] as const;
export const STOCK_LABELS: Record<(typeof STOCK_STATUSES)[number], string> = {
  IN_TRANSIT: "In transit",
  IN_STOCK: "In stock",
  RESERVED: "Reserved",
  SOLD: "Sold",
};

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const optInt = (min: number, max: number) => z.preprocess(empty, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? null);
/** Comma / newline separated list, or an array. */
const list = (max: number, item: z.ZodTypeAny = z.string().trim().min(1).max(300)) =>
  z
    .preprocess((v) => (typeof v === "string" ? v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : v ?? []), z.array(item).max(max))
    .default([]);
const httpUrl = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

export const productSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, "2–40 letters, digits, dot, dash or underscore"),
  category: z.enum(CATEGORIES).default("VEHICLE"),
  model: z.string().trim().min(1, "Model is required").max(80),
  variant: text(80),
  modelYear: optInt(1990, 2100),
  bodyType: text(40),
  fuel: text(40),
  transmission: text(40),
  engineCc: optInt(0, 20000),
  colours: list(30, z.string().trim().min(1).max(40)),
  listPrice: z.preprocess(empty, z.coerce.number().nonnegative().max(1e12).optional()).transform((v) => v ?? null),
  taxCode: z.string().trim().max(20).default("VAT"),
  taxRatePct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? 7.5),
  imageUrls: list(10, httpUrl),
  specSheetUrl: z.preprocess(empty, httpUrl.optional()).transform((v) => v ?? null),
  description: text(2000),
  active: z.preprocess((v) => (v === "on" || v === "true" ? true : v === "false" ? false : v), z.boolean()).default(true),
});
export type ProductInput = z.input<typeof productSchema>;

const date = z.preprocess(empty, z.coerce.date());
export const priceBookSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    validFrom: date,
    validTo: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null),
    active: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(true),
    isDefault: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
  })
  .refine((b) => b.validTo === null || b.validTo >= b.validFrom, { message: "Valid to must be on or after valid from", path: ["validTo"] });
export type PriceBookInput = z.input<typeof priceBookSchema>;

export const entrySchema = z.object({
  productId: z.string().min(1),
  price: z.coerce.number().nonnegative().max(1e12),
  maxDiscountPct: z.preprocess(empty, z.coerce.number().min(0).max(100).optional()).transform((v) => v ?? null),
  notes: text(300),
});

export const stockSchema = z.object({
  productId: z.string().min(1),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{5,40}$/, "5–40 letters, digits or dashes"),
  colour: text(40),
  location: text(80),
  status: z.enum(STOCK_STATUSES).default("IN_STOCK"),
});
