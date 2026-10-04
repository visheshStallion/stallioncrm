import { z } from "zod";
import { parseRule } from "./recurrence";

export const ACTIVITY_TYPES = ["TASK", "CALL", "MEETING", "TEST_DRIVE", "EMAIL_LOG", "WHATSAPP_LOG"] as const;
export type ActivityTypeKey = (typeof ACTIVITY_TYPES)[number];
export const TYPE_LABELS: Record<ActivityTypeKey, string> = {
  TASK: "Task",
  CALL: "Call",
  MEETING: "Meeting",
  TEST_DRIVE: "Test Drive",
  EMAIL_LOG: "Email",
  WHATSAPP_LOG: "WhatsApp",
};
export const ACTIVITY_STATUSES = ["OPEN", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export const STATUS_LABELS: Record<(typeof ACTIVITY_STATUSES)[number], string> = { OPEN: "Open", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show" };
export const PARENT_TYPES = ["Lead", "Deal", "Account", "Case"] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export const CALL_DISPOSITIONS = ["CONNECTED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "LEFT_MESSAGE"] as const;

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional()).transform((v) => v ?? null);
const when = z.preprocess(empty, z.coerce.date().optional()).transform((v) => v ?? null);
const optInt = (max: number) => z.preprocess(empty, z.coerce.number().int().min(0).max(max).optional()).transform((v) => v ?? null);
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
const optBool = z.preprocess((v) => (v === undefined ? undefined : v === true || v === "true" || v === "on"), z.boolean().optional());

export const activitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    parentType: z.enum(PARENT_TYPES),
    parentId: z.string().min(1),
    /** Only for Account parents: the brand context of the activity. */
    brandId: z.preprocess(empty, z.string().optional()),
    regionId: z.preprocess(empty, z.string().optional()),
    subject: z.string().trim().min(1, "Subject is required").max(200),
    description: text(4000),
    dueAt: when,
    startAt: when,
    endAt: when,
    priority: z.preprocess(empty, z.enum(PRIORITIES).optional()).transform((v) => v ?? "NORMAL"),
    ownerId: z.preprocess(empty, z.string().optional()),
    participants: z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []), z.array(z.string()).max(30)).default([]),
    reminderAt: when,
    recurrence: z
      .preprocess(empty, z.string().max(100).optional())
      .transform((v) => v ?? null)
      .refine((v) => v === null || parseRule(v) !== null, "Unsupported recurrence rule"),
    outcome: text(2000),
    // call
    direction: z.preprocess(empty, z.enum(["INBOUND", "OUTBOUND"]).optional()).transform((v) => v ?? null),
    durationSec: optInt(86_400),
    phone: text(40),
    recordingUrl: z.preprocess(empty, z.string().url().optional()).transform((v) => v ?? null),
    disposition: z.preprocess(empty, z.enum(CALL_DISPOSITIONS).optional()).transform((v) => v ?? null),
    /** log an already completed activity (calls, emails) */
    completed: bool.default(false),
    // test drive
    productId: z.preprocess(empty, z.string().optional()).transform((v) => v ?? null),
    vehicleVin: z.preprocess(empty, z.string().trim().toUpperCase().max(40).optional()).transform((v) => v ?? null),
    vehiclePlate: text(20),
    location: z.preprocess(empty, z.enum(["SHOWROOM", "HOME", "OTHER"]).optional()).transform((v) => v ?? "SHOWROOM"),
    licenceChecked: bool.default(false),
    licenceNumber: text(40),
    indemnitySigned: bool.default(false),
  })
  .superRefine((d, ctx) => {
    if ((d.type === "MEETING" || d.type === "TEST_DRIVE") && (!d.startAt || !d.endAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startAt"], message: "Start and end time are required" });
    }
    if (d.startAt && d.endAt && d.endAt <= d.startAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "End must be after start" });
    if (d.type === "TEST_DRIVE" && d.parentType !== "Deal" && d.parentType !== "Lead") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentType"], message: "A test drive belongs to a lead or deal" });
    }
  });
export type ActivityInput = z.input<typeof activitySchema>;

export const completeSchema = z.object({
  outcome: text(2000),
  status: z.preprocess(empty, z.enum(["COMPLETED", "NO_SHOW", "CANCELLED"]).optional()).transform((v) => v ?? "COMPLETED"),
  odometerStart: optInt(2_000_000),
  odometerEnd: optInt(2_000_000),
  feedbackRating: z.preprocess(empty, z.coerce.number().int().min(1).max(5).optional()).transform((v) => v ?? null),
  followUpAt: when,
  licenceChecked: optBool,
  indemnitySigned: optBool,
});
export type CompleteInput = z.input<typeof completeSchema>;
