/**
 * Field tiers for SHARED customers (BUSINESS_CONTEXT §8, prompt 03). Pure functions.
 *
 * | Tier      | Fields                                              | Who                                                        |
 * | BASIC     | name, type, city, industry, masked phone            | every CRM user                                             |
 * | CONTACT   | + full phone, email, address, DOB, notes …          | can see ≥1 brand record of the customer, or owns it        |
 * | SENSITIVE | + credit limit, KYC status, RC number               | scope ALL, or Brand Manager of a brand linked to the customer |
 *
 * Fields above the viewer's tier are returned as null (phones: masked) – identical in UI, API and export.
 */
import { maskEmail, maskPhone } from "./field-mask";
import type { AccessContext } from "./types";

export type CustomerTier = "BASIC" | "CONTACT" | "SENSITIVE";
const RANK: Record<CustomerTier, number> = { BASIC: 0, CONTACT: 1, SENSITIVE: 2 };
export const tierAtLeast = (tier: CustomerTier, min: CustomerTier) => RANK[tier] >= RANK[min];

export interface TierFacts {
  ownerId?: string | null;
  /** The viewer can see at least one brand-owned record (deal, quote, case …) of this customer. */
  hasVisibleBrandRecord: boolean;
  /** Brands linked to the customer (CustomerBrandLink). */
  linkedBrandIds: string[];
}

/** Brands where the user holds a brand-level manager membership (the Brand Manager). */
export function managedBrandIds(ctx: AccessContext): string[] {
  return ctx.memberships.filter((m) => m.regionId === null && m.isManager).map((m) => m.brandId);
}

export function customerTier(ctx: AccessContext, facts: TierFacts): CustomerTier {
  if (ctx.scope === "ALL") return "SENSITIVE";
  const managed = managedBrandIds(ctx);
  if (managed.some((b) => facts.linkedBrandIds.includes(b))) return "SENSITIVE";
  if (facts.hasVisibleBrandRecord || (!!facts.ownerId && facts.ownerId === ctx.userId)) return "CONTACT";
  return "BASIC";
}

export interface TierSpec {
  /** Shown masked at BASIC, in full from CONTACT. */
  phones: string[];
  /** Hidden (null) below CONTACT. */
  contact: string[];
  /** Hidden (null) below SENSITIVE. */
  sensitive: string[];
  /** Emails shown masked at BASIC instead of hidden (none by default). */
  maskedEmails?: string[];
}

export const ACCOUNT_TIERS: TierSpec = {
  phones: ["phone"],
  contact: ["email", "address", "state", "website", "notes"],
  sensitive: ["creditLimit", "kycStatus", "rcNumber"],
};

export const CONTACT_TIERS: TierSpec = {
  phones: ["mobile"],
  contact: ["altPhone", "email", "address", "dateOfBirth", "gender", "preferredChannel"],
  sensitive: [],
};

/** Applies the tier to a record. Returns a copy; never mutates. */
export function maskByTier<T extends Record<string, unknown>>(tier: CustomerTier, record: T, spec: TierSpec): T {
  const out: Record<string, unknown> = { ...record };
  if (!tierAtLeast(tier, "CONTACT")) {
    for (const f of spec.phones) if (out[f]) out[f] = maskPhone(String(out[f]));
    for (const f of spec.contact) if (f in out) out[f] = null;
    for (const f of spec.maskedEmails ?? []) if (out[f]) out[f] = maskEmail(String(out[f]));
  }
  if (!tierAtLeast(tier, "SENSITIVE")) {
    for (const f of spec.sensitive) if (f in out) out[f] = null;
  }
  return out as T;
}

/** Fields a user of this tier may write (everything they can see). */
export function writableFields(tier: CustomerTier, spec: TierSpec, basic: string[]): Set<string> {
  return new Set([
    ...basic,
    ...(tierAtLeast(tier, "CONTACT") ? [...spec.phones, ...spec.contact] : []),
    ...(tierAtLeast(tier, "SENSITIVE") ? spec.sensitive : []),
  ]);
}
