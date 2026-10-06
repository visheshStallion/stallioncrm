import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

export const LEAD_SOURCES = [
  "WALK_IN",
  "WEBSITE",
  "WHATSAPP",
  "FACEBOOK",
  "INSTAGRAM",
  "REFERRAL",
  "FLEET_CORPORATE",
  "EVENT",
  "PHONE",
] as const;
export const SOURCE_LABELS: Record<(typeof LEAD_SOURCES)[number], string> = {
  WALK_IN: "Walk-in",
  WEBSITE: "Website",
  WHATSAPP: "WhatsApp",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  REFERRAL: "Referral",
  FLEET_CORPORATE: "Fleet / Corporate",
  EVENT: "Event",
  PHONE: "Phone",
};

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;
export const STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  UNQUALIFIED: "Unqualified",
  CONVERTED: "Converted",
};
/** Statuses a user can set directly (CONVERTED only via the conversion wizard). */
export const SETTABLE_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"] as const;
export const OPEN_STATUSES = ["NEW", "CONTACTED", "QUALIFIED"] as const;

export const PAYMENT_INTENTS = ["CASH", "BANK_FINANCE", "LEASE", "FLEET"] as const;
export const PAYMENT_LABELS: Record<(typeof PAYMENT_INTENTS)[number], string> = {
  CASH: "Cash",
  BANK_FINANCE: "Bank finance",
  LEASE: "Lease",
  FLEET: "Fleet",
};
export const PURCHASE_WINDOWS = ["M0_1", "M1_3", "M3_6", "M6_PLUS"] as const;
export const WINDOW_LABELS: Record<(typeof PURCHASE_WINDOWS)[number], string> = {
  M0_1: "0–1 month",
  M1_3: "1–3 months",
  M3_6: "3–6 months",
  M6_PLUS: "6+ months",
};
export const RATINGS = ["HOT", "WARM", "COLD"] as const;

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const phoneSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid phone number" });
    return p;
  });

const leadFields = {
  firstName: text(80),
  // a person (last name) or a company enquiry (company) – one of the two is required
  lastName: text(80),
  company: text(160),
  mobile: phoneSchema,
  email: z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email().optional()).transform((v) => v ?? null),
  city: text(80),
  source: z.enum(LEAD_SOURCES).default("WALK_IN"),
  sourceDetail: text(200),
  modelOfInterestId: z.preprocess(emptyToUndef, z.string().optional()).transform((v) => v ?? null),
  budget: z.preprocess(emptyToUndef, z.coerce.number().nonnegative().max(1e12).optional()).transform((v) => v ?? null),
  paymentIntent: z.preprocess(emptyToUndef, z.enum(PAYMENT_INTENTS).optional()).transform((v) => v ?? null),
  tradeIn: z.coerce.boolean().default(false),
  tradeInNotes: text(500),
  expectedPurchaseWindow: z.preprocess(emptyToUndef, z.enum(PURCHASE_WINDOWS).optional()).transform((v) => v ?? null),
  rating: z.preprocess(emptyToUndef, z.enum(RATINGS).optional()).transform((v) => v ?? null),
  consentMarketing: z.coerce.boolean().default(false),
};

export const createLeadSchema = z
  .object({
    ...leadFields,
    brandId: z.string().min(1, "Brand is required"),
    regionId: z.string().min(1, "Region is required"),
    ownerId: z.preprocess(emptyToUndef, z.string().optional()),
    status: z.enum(SETTABLE_STATUSES).default("NEW"),
    unqualifiedReason: text(300),
  })
  .refine((d) => d.lastName || d.company, { message: "Enter a last name or a company", path: ["lastName"] })
  .refine((d) => d.mobile || d.email, { message: "Mobile or email is required", path: ["mobile"] })
  .refine((d) => d.status !== "UNQUALIFIED" || d.unqualifiedReason, {
    message: "Give a reason when marking a lead unqualified",
    path: ["unqualifiedReason"],
  });
export type CreateLeadInput = z.input<typeof createLeadSchema>;

/** Brand is not editable after create (brand change goes through approval, prompt 08). */
export const updateLeadSchema = z
  .object({
    ...leadFields,
    regionId: z.string().min(1),
    status: z.enum(SETTABLE_STATUSES),
    unqualifiedReason: text(300),
  })
  .partial()
  .refine((d) => d.status !== "UNQUALIFIED" || d.unqualifiedReason, {
    message: "Give a reason when marking a lead unqualified",
    path: ["unqualifiedReason"],
  });
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

export const leadFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  open: z.coerce.boolean().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  rating: z.enum(RATINGS).optional(),
  brandId: z.string().optional(),
  regionId: z.string().optional(),
  ownerId: z.string().optional(),
  mine: z.coerce.boolean().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

/** Parses URL params leniently: invalid values are dropped, never thrown. */
export function parseLeadFilters(params: Record<string, string | undefined | null>): LeadFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!v || !(k in leadFiltersSchema.shape)) continue;
    const r = (leadFiltersSchema.shape as Record<string, z.ZodTypeAny>)[k]!.safeParse(v);
    if (r.success && r.data !== undefined) out[k] = r.data;
  }
  return out as LeadFilters;
}

/** Public web-to-lead payload. Brand never comes from the payload – only from the URL. */
export const intakeSchema = z
  .object({
    firstName: text(80),
    lastName: z.string().trim().min(1).max(80),
    mobile: phoneSchema,
    email: z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email().optional()).transform((v) => v ?? null),
    city: text(80),
    region: z.string().trim().min(1).max(60),
    model: text(80),
    message: text(1000),
    consentMarketing: z.coerce.boolean().default(false),
    utm_source: text(100),
    utm_medium: text(100),
    utm_campaign: text(100),
    utm_term: text(100),
    utm_content: text(100),
    referrer: text(500),
    /** honeypot – must stay empty */
    website: z.string().optional().nullable(),
    recaptchaToken: z.string().optional().nullable(),
  })
  .strip()
  .refine((d) => d.mobile || d.email, { message: "Mobile or email is required", path: ["mobile"] });
export type IntakePayload = z.infer<typeof intakeSchema>;
