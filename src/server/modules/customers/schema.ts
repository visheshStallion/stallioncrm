import { z } from "zod";
import { phoneSchema } from "@/server/modules/leads/schema";

export const ACCOUNT_TYPES = ["INDIVIDUAL", "CORPORATE", "GOVERNMENT", "FLEET"] as const;
export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  INDIVIDUAL: "Individual",
  CORPORATE: "Corporate",
  GOVERNMENT: "Government",
  FLEET: "Fleet",
};
export const KYC_STATUSES = ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"] as const;
export const KYC_LABELS: Record<(typeof KYC_STATUSES)[number], string> = {
  NOT_STARTED: "Not started",
  PENDING: "Pending",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};
export const CHANNELS = ["PHONE", "WHATSAPP", "EMAIL", "SMS"] as const;

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const email = z.preprocess(empty, z.string().trim().toLowerCase().email().optional()).transform((v) => v ?? null);

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(ACCOUNT_TYPES).default("INDIVIDUAL"),
  industry: text(100),
  city: text(80),
  state: text(80),
  address: text(300),
  phone: phoneSchema,
  email,
  website: text(200),
  notes: text(2000),
  rcNumber: text(40),
  creditLimit: z.preprocess(empty, z.coerce.number().nonnegative().max(1e13).optional()).transform((v) => v ?? null),
  kycStatus: z.preprocess(empty, z.enum(KYC_STATUSES).optional()),
});
export type AccountInput = z.input<typeof accountSchema>;
/** Fields every user with edit permission may write (the rest depends on the tier). */
export const ACCOUNT_BASIC_FIELDS = ["name", "type", "industry", "city"];

export const contactSchema = z.object({
  accountId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
  firstName: text(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  mobile: phoneSchema,
  altPhone: phoneSchema,
  email,
  dateOfBirth: z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null),
  gender: text(20),
  city: text(80),
  address: text(300),
  preferredChannel: z.preprocess(empty, z.enum(CHANNELS).optional()).transform((v) => v ?? null),
});
export type ContactInput = z.input<typeof contactSchema>;
export const CONTACT_BASIC_FIELDS = ["accountId", "firstName", "lastName", "city"];
