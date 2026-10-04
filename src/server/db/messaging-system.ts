/**
 * System-side queries of the messaging module (prompt 10). They serve requests that have no signed-in user –
 * provider webhooks, unsubscribe links, the campaign worker – and are therefore narrow and brand-explicit:
 * every function takes (or derives) ONE brand and never returns data of another.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type { MemberStatus, MessageStatus } from "@prisma/client";
import { unsafeDb } from "./unsafe";

/** The brand a number / WhatsApp phone id belongs to (inbound messages are routed by the RECEIVING number). */
export async function brandByReceiver(channel: "SMS" | "WHATSAPP", receiver: string) {
  const value = receiver.trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return unsafeDb.brand.findFirst({
    where:
      channel === "WHATSAPP"
        ? { OR: [{ whatsappPhoneId: value }, { whatsappNumber: value }, { whatsappNumber: `+${digits}` }] }
        : { OR: [{ smsInboundNumber: value }, { smsInboundNumber: `+${digits}` }, { smsInboundNumber: digits }] },
    select: { id: true, code: true, name: true, status: true },
  });
}

export interface InboundTarget {
  parentType: "Lead" | "Deal";
  parentId: string;
  regionId: string;
  ownerId: string;
  contactId: string | null;
}

/** The open lead – or open deal of a known contact – of THIS brand for a sender's phone number. */
export async function findInboundTarget(brandId: string, phone: string): Promise<InboundTarget | null> {
  const lead = await unsafeDb.lead.findFirst({
    where: { brandId, mobile: phone, deletedAt: null, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
    select: { id: true, regionId: true, ownerId: true },
    orderBy: { createdAt: "desc" },
  });
  if (lead) return { parentType: "Lead", parentId: lead.id, regionId: lead.regionId, ownerId: lead.ownerId, contactId: null };
  const deal = await unsafeDb.deal.findFirst({
    where: { brandId, deletedAt: null, stage: { type: "OPEN" }, contact: { deletedAt: null, OR: [{ mobile: phone }, { altPhone: phone }] } },
    select: { id: true, regionId: true, ownerId: true, contactId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (deal) return { parentType: "Deal", parentId: deal.id, regionId: deal.regionId, ownerId: deal.ownerId, contactId: deal.contactId };
  return null;
}

/** The newest campaign of the brand that messaged this address (attribution of a reply / new lead). */
export async function campaignForAddress(brandId: string, address: string): Promise<{ campaignId: string; memberId: string } | null> {
  const m = await unsafeDb.campaignMember.findFirst({
    where: { address, campaign: { brandId }, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED", "RESPONDED"] } },
    select: { id: true, campaignId: true },
    orderBy: { sentAt: "desc" },
  });
  return m ? { campaignId: m.campaignId, memberId: m.id } : null;
}

const MESSAGE_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4 };
const MEMBER_RANK: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4, RESPONDED: 5 };

/**
 * Delivery report from a provider. Statuses only move forward (a late "delivered" never overwrites "opened");
 * FAILED applies only while the message is not delivered yet.
 */
export async function applyDeliveryStatus(providerMessageId: string, status: "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "FAILED", error?: string | null): Promise<boolean> {
  const message = await unsafeDb.message.findFirst({ where: { providerMessageId, direction: "OUT" }, select: { id: true, status: true, campaignMemberId: true } });
  if (!message) return false;
  const now = new Date();
  if (status === "FAILED") {
    if ((MESSAGE_RANK[message.status] ?? 9) >= 2) return true;
    await unsafeDb.message.update({ where: { id: message.id }, data: { status: "FAILED", error: error?.slice(0, 500) ?? "Delivery failed" } });
    if (message.campaignMemberId) await unsafeDb.campaignMember.updateMany({ where: { id: message.campaignMemberId, status: { in: ["PENDING", "SENT"] } }, data: { status: "FAILED", reason: error?.slice(0, 300) ?? "Delivery failed" } });
    return true;
  }
  if ((MESSAGE_RANK[status] ?? 0) > (MESSAGE_RANK[message.status] ?? 9)) {
    await unsafeDb.message.update({ where: { id: message.id }, data: { status: status as MessageStatus, ...(status === "DELIVERED" ? { deliveredAt: now } : {}) } });
  }
  if (message.campaignMemberId) {
    const member = await unsafeDb.campaignMember.findUnique({ where: { id: message.campaignMemberId }, select: { status: true } });
    if (member && (MEMBER_RANK[status] ?? 0) > (MEMBER_RANK[member.status] ?? 9)) {
      await unsafeDb.campaignMember.update({ where: { id: message.campaignMemberId }, data: { status: status as MemberStatus } });
    }
  }
  return true;
}

export async function markResponded(memberId: string): Promise<void> {
  await unsafeDb.campaignMember.updateMany({ where: { id: memberId, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED"] } }, data: { status: "RESPONDED" } });
}

/** Marketing consent of a recipient for ONE brand: true = may be contacted, false = opted out, null = never asked. */
export async function consentFor(brandId: string, who: { contactId?: string | null; leadId?: string | null }): Promise<boolean | null> {
  if (who.contactId) {
    const c = await unsafeDb.contactBrandConsent.findUnique({ where: { contactId_brandId: { contactId: who.contactId, brandId } }, select: { consent: true } });
    return c ? c.consent : null;
  }
  if (who.leadId) {
    const l = await unsafeDb.lead.findFirst({ where: { id: who.leadId, brandId }, select: { consentMarketing: true, consentAt: true } });
    return l ? (l.consentMarketing ? true : l.consentAt ? false : null) : null;
  }
  return null;
}

/** Opt-out for ONE brand (STOP reply, unsubscribe link). Other brands' consent is untouched. */
export async function optOut(brandId: string, who: { contactId?: string | null; leadId?: string | null; phone?: string | null; email?: string | null }): Promise<number> {
  const now = new Date();
  let changed = 0;
  const contactIds = new Set<string>(who.contactId ? [who.contactId] : []);
  if (who.phone || who.email) {
    const contacts = await unsafeDb.contact.findMany({
      where: { deletedAt: null, OR: [...(who.phone ? [{ mobile: who.phone }, { altPhone: who.phone }] : []), ...(who.email ? [{ email: { equals: who.email, mode: "insensitive" as const } }] : [])] },
      select: { id: true },
      take: 50,
    });
    contacts.forEach((c) => contactIds.add(c.id));
  }
  for (const contactId of contactIds) {
    await unsafeDb.contactBrandConsent.upsert({ where: { contactId_brandId: { contactId, brandId } }, update: { consent: false, at: now }, create: { contactId, brandId, consent: false, at: now } });
    changed++;
  }
  const leads = await unsafeDb.lead.updateMany({
    where: { brandId, deletedAt: null, OR: [...(who.leadId ? [{ id: who.leadId }] : []), ...(who.phone ? [{ mobile: who.phone }] : []), ...(who.email ? [{ email: { equals: who.email, mode: "insensitive" as const } }] : [])] },
    data: { consentMarketing: false, consentAt: now },
  });
  return changed + leads.count;
}

export function memberByToken(token: string) {
  return unsafeDb.campaignMember.findUnique({
    where: { unsubscribeToken: token },
    select: { id: true, status: true, contactId: true, leadId: true, address: true, campaign: { select: { brandId: true, channel: true, brand: { select: { name: true, code: true } } } } },
  });
}

/** Unsubscribe link: opts the recipient out of the campaign's brand and marks the member. Idempotent. */
export async function unsubscribeByToken(token: string): Promise<{ brandName: string } | null> {
  const m = await memberByToken(token);
  if (!m) return null;
  await optOut(m.campaign.brandId, { contactId: m.contactId, leadId: m.leadId, ...(m.campaign.channel === "EMAIL" ? { email: m.address } : { phone: m.address }) });
  await unsafeDb.campaignMember.update({ where: { id: m.id }, data: { status: "UNSUBSCRIBED" } });
  return { brandName: m.campaign.brand.name };
}

export const newToken = () => randomBytes(24).toString("base64url");

/** Campaign worker: the next pending members of a campaign that is being sent. */
export async function pendingMembers(campaignId: string, take: number) {
  return unsafeDb.campaignMember.findMany({ where: { campaignId, status: "PENDING", campaign: { status: "SENDING" } }, orderBy: { id: "asc" }, take });
}

export async function campaignForWorker(campaignId: string) {
  return unsafeDb.campaign.findUnique({ where: { id: campaignId }, include: { template: true, brand: true } });
}

export async function finishCampaignIfDone(campaignId: string): Promise<boolean> {
  const left = await unsafeDb.campaignMember.count({ where: { campaignId, status: "PENDING" } });
  if (left > 0) return false;
  await unsafeDb.campaign.updateMany({ where: { id: campaignId, status: "SENDING" }, data: { status: "SENT" } });
  return true;
}

/** Default region for a lead created from an unknown inbound sender: Lagos (head office), else the first active region. */
export async function defaultInboundRegion(): Promise<string | null> {
  const r = (await unsafeDb.region.findFirst({ where: { active: true, name: { equals: "Lagos", mode: "insensitive" } }, select: { id: true } })) ?? (await unsafeDb.region.findFirst({ where: { active: true }, select: { id: true }, orderBy: { name: "asc" } }));
  return r?.id ?? null;
}
