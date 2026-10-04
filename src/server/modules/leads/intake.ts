/**
 * Web-to-Lead and channel webhooks (prompt 02 §5): POST /api/public/leads/:brandCode[?channel=…].
 *
 * Isolation: the brand comes ONLY from the URL. The lead is written through scopedDb with a SYSTEM
 * context whose only membership is that brand – so even a forged payload cannot create a lead for
 * another brand (the payload schema strips brand fields, and scopedDb/RLS would reject them anyway).
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { intakeSchema, type IntakePayload } from "./schema";
import { createLead } from "./service";

export class NotImplementedError extends Error {
  readonly status = 501;
}

/** Channel adapters turn a provider request into lead payloads. */
export interface LeadChannelAdapter {
  channel: "web" | "whatsapp" | "facebook";
  source: "WEBSITE" | "WHATSAPP" | "FACEBOOK";
  parse(req: Request): Promise<unknown[]>;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return ((await req.json()) ?? {}) as Record<string, unknown>;
  if (type.includes("form")) return Object.fromEntries((await req.formData()).entries());
  throw new BadRequestError("Send JSON or form data");
}

export const ADAPTERS: Record<string, LeadChannelAdapter> = {
  web: { channel: "web", source: "WEBSITE", parse: async (req) => [await readBody(req)] },
  // Provider integrations are stubs until the channels are contracted (see docs). They must verify the
  // provider signature (X-Hub-Signature-256 for Meta) before parsing.
  whatsapp: {
    channel: "whatsapp",
    source: "WHATSAPP",
    parse: async () => {
      throw new NotImplementedError("WhatsApp lead adapter is not configured");
    },
  },
  facebook: {
    channel: "facebook",
    source: "FACEBOOK",
    parse: async () => {
      throw new NotImplementedError("Facebook lead-ads adapter is not configured");
    },
  },
};

/** System context scoped to exactly one brand (all regions). */
export function intakeContext(brandId: string): AccessContext {
  return {
    userId: "",
    user: { name: "Web intake", email: "", roleName: "System" },
    scope: "TERRITORY",
    profile: { id: "system", name: "System", permissions: { leads: { read: true, create: true } }, fieldPermissions: {} },
    memberships: [{ territoryId: "system", brandId, regionId: null, isManager: false }],
    brandIds: [brandId],
    isAdmin: false,
    system: true,
  };
}

async function verifyRecaptcha(token: string | null | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // optional
  if (!token) return false;
  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const body = (await res.json()) as { success?: boolean; score?: number };
    return !!body.success && (body.score === undefined || body.score >= 0.5);
  } catch (err) {
    logger.warn({ err }, "recaptcha verification failed");
    return false;
  }
}

export type IntakeResult = { status: "created"; leadId: string } | { status: "ignored" };

/** Validates and creates one lead for `brandCode`. Honeypot hits are silently ignored. */
export async function intakeLead(
  brandCode: string,
  raw: unknown,
  meta: { source: LeadChannelAdapter["source"]; ip: string | null },
): Promise<IntakeResult> {
  const payload: IntakePayload = intakeSchema.parse(raw);
  if (payload.website) return { status: "ignored" }; // honeypot
  if (!(await verifyRecaptcha(payload.recaptchaToken, meta.ip))) throw new BadRequestError("reCAPTCHA check failed");

  const brand = await scopedDb(intakeContext("lookup")).brand.findUnique({
    where: { code: brandCode.toUpperCase() },
    select: { id: true, status: true },
  });
  if (!brand || brand.status === "INACTIVE") throw new BadRequestError("Unknown brand");
  const ctx = intakeContext(brand.id);
  const db = scopedDb(ctx);
  const region = await db.region.findFirst({
    where: { name: { equals: payload.region, mode: "insensitive" }, active: true },
    select: { id: true },
  });
  if (!region) throw new BadRequestError("Unknown region");
  const model = payload.model
    ? await db.product.findFirst({
        where: { brandId: brand.id, active: true, OR: [{ id: payload.model }, { code: payload.model }, { name: payload.model }] },
        select: { id: true },
      })
    : null;

  const utm = Object.fromEntries(
    (["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer"] as const)
      .filter((k) => payload[k])
      .map((k) => [k, payload[k]]),
  );

  const lead = await createLead(
    ctx,
    {
      firstName: payload.firstName,
      lastName: payload.lastName,
      mobile: payload.mobile,
      email: payload.email,
      city: payload.city,
      source: meta.source,
      sourceDetail: payload.message,
      modelOfInterestId: model?.id ?? null,
      consentMarketing: payload.consentMarketing,
      brandId: brand.id,
      regionId: region.id,
    },
    { autoAssign: true },
  );
  if (Object.keys(utm).length) await db.lead.update({ where: { id: lead.id }, data: { utm }, select: { id: true } });
  // Campaign attribution: utm_campaign carries the campaign code (campaigns of this brand only).
  if (payload.utm_campaign) {
    const campaign = await db.campaign.findFirst({ where: { code: payload.utm_campaign.toUpperCase(), brandId: brand.id }, select: { id: true } });
    if (campaign) await db.lead.update({ where: { id: lead.id }, data: { campaignId: campaign.id }, select: { id: true } });
  }
  return { status: "created", leadId: lead.id };
}
