import { z } from "zod";
import { MODULE_KEYS } from "@/server/access/modules";
import { ACTIONS } from "@/server/access/types";

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const brandSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, "2–12 letters/digits"),
  name: z.string().trim().min(1).max(100),
  legalEntity: optionalText(),
  erpCompanyCode: optionalText(50),
  docPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, "1–10 letters/digits/dashes")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "hex colour like #1d4ed8")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  logoUrl: z.string().trim().url().optional().nullable().or(z.literal("").transform(() => null)),
  status: z.enum(["ACTIVE", "FUTURE", "INACTIVE"]).default("ACTIVE"),
  brandManagerId: optionalId,
  // Document template (quotes / orders / invoices) and discount approval thresholds
  address: optionalText(500),
  bankDetails: optionalText(1000),
  documentTerms: optionalText(4000),
  discountApprovalPct: z.preprocess((v) => (v === "" || v === null || v === undefined ? 3 : v), z.coerce.number().min(0).max(100)),
  discountEscalationPct: z.preprocess((v) => (v === "" || v === null || v === undefined ? 7 : v), z.coerce.number().min(0).max(100)),
});
export type BrandInput = z.input<typeof brandSchema>;

export const aliasSchema = z.object({
  alias: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,20}$/, "1–20 letters/digits"),
  brandId: z.string().min(1),
  note: optionalText(200),
});

export const regionSchema = z.object({ name: z.string().trim().min(2).max(60) });

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  parentRoleId: optionalId,
});

export const profileCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  cloneFromId: z.string().min(1),
});

export const permissionGridSchema = z.object({
  scope: z.enum(["ALL", "TERRITORY"]),
  permissions: z.record(
    z.enum(MODULE_KEYS as [string, ...string[]]),
    z.record(z.enum(ACTIONS as unknown as [string, ...string[]]), z.boolean()),
  ),
});

export const fieldPermissionSchema = z.record(z.string(), z.enum(["hidden", "masked", "read", "edit"]));

export const userSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  roleId: z.string().min(1),
  profileId: z.string().min(1),
  managerId: optionalId,
  password: z
    .string()
    .min(10, "at least 10 characters")
    .max(200)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});
export type UserInput = z.input<typeof userSchema>;

export const passwordSchema = z.string().min(10, "at least 10 characters").max(200);
