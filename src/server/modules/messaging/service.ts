/**
 * Messaging service (prompt 10): email, SMS and WhatsApp behind one interface.
 *   • Sender identity per brand – a message about an HMNL record is always sent as HMNL (never chosen by the user).
 *   • Every outbound / inbound message is logged as an Activity + Message on the record; both are brand-owned,
 *     so the content of a message on an SNMNL record is invisible to HMNL users (scopedDb + RLS).
 *   • Inbound messages are routed by the RECEIVING number to that brand's open lead / deal; unknown senders
 *     become a new lead of that brand.
 */
import "server-only";
import type { Brand, Channel } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { brandByReceiver, campaignForAddress, defaultInboundRegion, findInboundTarget, markResponded, optOut } from "@/server/db/messaging-system";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { createLead } from "@/server/modules/leads/service";
import { notify } from "@/server/modules/notifications/service";
import { automationContext } from "@/server/modules/workflow/engine";
import { isValidEmail, renderMerge, type MergeData } from "./merge";
import { providerFor, type OutboundMessage } from "./providers";

export const CHANNEL_LABELS: Record<Channel, string> = { EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" };
const ACTIVITY_TYPE = { EMAIL: "EMAIL_LOG", SMS: "SMS_LOG", WHATSAPP: "WHATSAPP_LOG" } as const;

type BrandIdentity = Pick<Brand, "id" | "code" | "name" | "fromName" | "fromEmail" | "smsSenderId" | "whatsappNumber" | "whatsappPhoneId">;
const IDENTITY_SELECT = { id: true, code: true, name: true, fromName: true, fromEmail: true, smsSenderId: true, whatsappNumber: true, whatsappPhoneId: true } as const;

/** The brand's sender identity for a channel – 400 when the brand has none configured (nothing is sent as another brand). */
export function senderIdentity(brand: BrandIdentity, channel: Channel): OutboundMessage["from"] {
  if (channel === "EMAIL" && brand.fromEmail) return { name: brand.fromName || brand.name, address: brand.fromEmail };
  if (channel === "SMS" && brand.smsSenderId) return { name: brand.name, address: brand.smsSenderId };
  if (channel === "WHATSAPP" && brand.whatsappNumber) return { name: brand.name, address: brand.whatsappNumber, whatsappPhoneId: brand.whatsappPhoneId };
  throw new BadRequestError(`${brand.code} has no ${CHANNEL_LABELS[channel]} sender configured (Setup → Brands)`);
}

export interface Recipient {
  name: string;
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  email: string | null;
  contactId: string | null;
  leadId: string | null;
}
export interface MessageRecord {
  parentType: "Lead" | "Deal";
  parentId: string;
  brandId: string;
  regionId: string;
  ownerId: string;
  recipient: Recipient;
  merge: MergeData;
}

/** Loads the lead / deal through the scoped client (404 when hidden) with its customer and merge data. */
export async function loadMessageRecord(ctx: AccessContext, parentType: string, parentId: string): Promise<MessageRecord> {
  const db = scopedDb(ctx);
  if (parentType === "Lead") {
    const l = await db.lead.findUnique({ where: { id: parentId }, include: { modelOfInterest: { select: { name: true } }, owner: { select: { name: true } }, brand: { select: { name: true, code: true } } } });
    if (!l) throw new NotFoundError();
    const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
    return {
      parentType: "Lead",
      parentId,
      brandId: l.brandId,
      regionId: l.regionId,
      ownerId: l.ownerId,
      recipient: { name, firstName: l.firstName, lastName: l.lastName, mobile: l.mobile, email: l.email, contactId: null, leadId: l.id },
      merge: { contact: { firstName: l.firstName ?? l.lastName, lastName: l.lastName, name }, deal: { name: "", model: l.modelOfInterest?.name }, brand: l.brand, owner: l.owner },
    };
  }
  if (parentType === "Deal") {
    const d = await db.deal.findUnique({
      where: { id: parentId },
      include: { contact: true, account: { select: { name: true, phone: true, email: true } }, model: { select: { name: true } }, owner: { select: { name: true } }, brand: { select: { name: true, code: true } } },
    });
    if (!d) throw new NotFoundError();
    const c = d.contact;
    const name = c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : (d.account?.name ?? d.customerName ?? "");
    return {
      parentType: "Deal",
      parentId,
      brandId: d.brandId,
      regionId: d.regionId,
      ownerId: d.ownerId,
      recipient: { name, firstName: c?.firstName ?? null, lastName: c?.lastName ?? null, mobile: c?.mobile ?? d.account?.phone ?? null, email: c?.email ?? d.account?.email ?? null, contactId: c?.id ?? null, leadId: null },
      merge: { contact: { firstName: c?.firstName ?? name, lastName: c?.lastName, name }, deal: { name: d.name, model: d.model?.name }, brand: d.brand, owner: d.owner },
    };
  }
  throw new BadRequestError("Messages can be sent from a lead or a deal");
}

function addressFor(channel: Channel, r: Recipient): string {
  if (channel === "EMAIL") {
    if (!r.email || !isValidEmail(r.email)) throw new BadRequestError("The customer has no valid email address");
    return r.email;
  }
  const phone = normalizePhone(r.mobile);
  if (!phone) throw new BadRequestError("The customer has no valid mobile number");
  return phone;
}

export interface DeliverInput {
  channel: Channel;
  record: MessageRecord;
  subject?: string | null;
  /** already merged text */
  body: string;
  templateId?: string | null;
  whatsappTemplate?: OutboundMessage["whatsappTemplate"];
  campaignId?: string | null;
  campaignMemberId?: string | null;
  unsubscribeUrl?: string | null;
  /** override of the recipient address (campaign members carry their own) */
  to?: string;
}

/**
 * Logs (Activity + Message) and sends one message with the brand's identity. The log is written first, so a
 * provider failure leaves a FAILED message on the record instead of nothing.
 */
export async function deliver(ctx: AccessContext, input: DeliverInput) {
  const db = scopedDb(ctx);
  const { record, channel } = input;
  const brand = await db.brand.findUnique({ where: { id: record.brandId }, select: { ...IDENTITY_SELECT, status: true } });
  if (!brand) throw new NotFoundError();
  if (brand.status === "INACTIVE") throw new BadRequestError(`Brand ${brand.code} is inactive`);
  const from = senderIdentity(brand, channel);
  const to = input.to ?? addressFor(channel, record.recipient);
  const subject = channel === "EMAIL" ? (input.subject?.trim() || `Message from ${brand.name}`).slice(0, 200) : null;
  const ownerId = ctx.system ? record.ownerId : ctx.userId;

  const activity = await db.activity.create({
    data: {
      type: ACTIVITY_TYPE[channel],
      parentType: record.parentType,
      parentId: record.parentId,
      subject: (subject ?? `${CHANNEL_LABELS[channel]} to ${record.recipient.name || to}`).slice(0, 200),
      description: input.body.slice(0, 4000),
      status: "COMPLETED",
      completedAt: new Date(),
      dueAt: new Date(),
      direction: "OUTBOUND",
      phone: channel === "EMAIL" ? null : to,
      brandId: record.brandId,
      regionId: record.regionId,
      ownerId,
    },
    select: { id: true },
  });
  const message = await db.message.create({
    data: {
      channel,
      direction: "OUT",
      status: "QUEUED",
      parentType: record.parentType,
      parentId: record.parentId,
      activityId: activity.id,
      contactId: record.recipient.contactId,
      campaignId: input.campaignId ?? null,
      campaignMemberId: input.campaignMemberId ?? null,
      templateId: input.templateId ?? null,
      fromAddress: from.address,
      toAddress: to,
      subject,
      body: input.body,
      brandId: record.brandId,
      regionId: record.regionId,
      ownerId,
    },
    select: { id: true },
  });
  try {
    const { providerMessageId } = await providerFor(channel).send({ channel, from, to, subject, text: input.body, whatsappTemplate: input.whatsappTemplate ?? null, unsubscribeUrl: input.unsubscribeUrl ?? null });
    await db.message.update({ where: { id: message.id }, data: { status: "SENT", providerMessageId, sentAt: new Date() }, select: { id: true } });
    return { id: message.id, activityId: activity.id, status: "SENT" as const, providerMessageId, from: from.address, to, error: null };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    logger.warn({ channel, brand: brand.code, error }, "message could not be sent");
    await db.message.update({ where: { id: message.id }, data: { status: "FAILED", error }, select: { id: true } });
    await db.activity.update({ where: { id: activity.id }, data: { outcome: `Not sent: ${error}`.slice(0, 2000) }, select: { id: true } });
    return { id: message.id, activityId: activity.id, status: "FAILED" as const, providerMessageId: null, from: from.address, to, error };
  }
}

const sendSchema = z.object({
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
  parentType: z.enum(["Lead", "Deal"]),
  parentId: z.string().min(1),
  templateId: z.string().nullish().transform((v) => v || null),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().max(4000).nullish(),
});

/** WhatsApp: free text only inside the 24-hour window after the customer's last message; otherwise an approved template. */
async function whatsappSessionOpen(ctx: AccessContext, record: MessageRecord, to: string): Promise<boolean> {
  const last = await scopedDb(ctx).message.findFirst({ where: { channel: "WHATSAPP", direction: "IN", brandId: record.brandId, fromAddress: to, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }, select: { id: true } });
  return !!last;
}

/**
 * One-to-one message from a lead / deal (service message – no marketing consent needed, but an explicit opt-out
 * of SMS / WhatsApp marketing does not block it either: it concerns the customer's own enquiry).
 */
export async function sendMessage(ctx: AccessContext, input: unknown) {
  const data = sendSchema.parse(input);
  const record = await loadMessageRecord(ctx, data.parentType, data.parentId);
  assertCan(ctx, "activities", "create", record);
  const db = scopedDb(ctx);
  const template = data.templateId ? await db.template.findFirst({ where: { id: data.templateId, channel: data.channel, active: true, OR: [{ brandId: null }, { brandId: record.brandId }] } }) : null;
  if (data.templateId && !template) throw new BadRequestError("This template is not available for the record's brand");
  const text = renderMerge(data.body || template?.body || "", record.merge).trim();
  if (!text) throw new BadRequestError("Write a message or choose a template");
  let whatsappTemplate: OutboundMessage["whatsappTemplate"] = null;
  if (data.channel === "WHATSAPP") {
    const to = addressFor("WHATSAPP", record.recipient);
    if (template?.whatsappStatus === "APPROVED" && template.whatsappName && !data.body) whatsappTemplate = { name: template.whatsappName, parameters: [record.recipient.firstName ?? record.recipient.name] };
    else if (!(await whatsappSessionOpen(ctx, record, to))) throw new BadRequestError("WhatsApp only allows free text within 24 hours of the customer's last message – use an approved template");
  }
  return deliver(ctx, { channel: data.channel, record, subject: renderMerge(data.subject || template?.subject || "", record.merge), body: text, templateId: template?.id ?? null, whatsappTemplate });
}

/** Messages of a record (brand-scoped). */
export async function recordMessages(ctx: AccessContext, parentType: string, parentId: string) {
  const rows = await scopedDb(ctx).message.findMany({ where: { parentType, parentId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, channel: true, direction: true, status: true, fromAddress: true, toAddress: true, subject: true, body: true, error: true, createdAt: true, owner: { select: { name: true } } } });
  return rows.map((m) => ({ ...m, at: m.createdAt.toISOString(), ownerName: m.owner.name }));
}

// ───────────────────────────── internal email to users ─────────────────────────────

/** Email to CRM users (notifications, workflow emails). Uses the brand's identity when given, else MAIL_FROM. */
export async function emailUsers(userIds: string[], subject: string, text: string, brandId?: string | null): Promise<number> {
  if (userIds.length === 0) return 0;
  const ctx = automationContext(brandId ?? "", brandId ? "TERRITORY" : "ALL");
  const db = scopedDb(ctx);
  const [users, brand] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds }, active: true }, select: { email: true } }),
    brandId ? db.brand.findUnique({ where: { id: brandId }, select: IDENTITY_SELECT }) : null,
  ]);
  const from = brand?.fromEmail ? { name: brand.fromName || brand.name, address: brand.fromEmail } : { name: process.env.MAIL_FROM_NAME ?? "Stallion CRM", address: process.env.MAIL_FROM ?? "crm@example.test" };
  let sent = 0;
  for (const u of users) {
    if (!isValidEmail(u.email)) continue;
    try {
      await providerFor("EMAIL").send({ channel: "EMAIL", from, to: u.email, subject, text });
      sent++;
    } catch (err) {
      logger.warn({ err }, "user email could not be sent");
    }
  }
  return sent;
}

// ───────────────────────────── inbound ─────────────────────────────

const STOP = /^\s*(stop|stop all|unsubscribe|opt[\s-]?out|cancel)\s*[.!]?\s*$/i;

export interface InboundMessage {
  channel: "SMS" | "WHATSAPP";
  /** the number (or WhatsApp phone id) that RECEIVED the message – decides the brand */
  receiver: string;
  from: string;
  text: string;
  providerMessageId?: string | null;
  senderName?: string | null;
}

/**
 * Inbound SMS / WhatsApp. The brand is the owner of the receiving number – a customer who writes to the SNMNL
 * number lands in SNMNL even when they are also an HMNL customer. Matched by phone to the brand's open lead or
 * deal; unknown senders create a lead for that brand (assigned by the brand's assignment rules).
 */
export async function receiveInbound(msg: InboundMessage): Promise<{ status: "ignored" | "logged" | "lead_created"; brandCode?: string; parentType?: string; parentId?: string }> {
  const brand = await brandByReceiver(msg.channel, msg.receiver);
  if (!brand || brand.status === "INACTIVE") return { status: "ignored" };
  const phone = normalizePhone(msg.from);
  const text = msg.text.trim().slice(0, 4000);
  if (!phone || !text) return { status: "ignored" };
  const ctx: AccessContext = { ...automationContext(brand.id), automation: false, user: { name: `${CHANNEL_LABELS[msg.channel]} inbound`, email: "", roleName: "System" } };
  const db = scopedDb(ctx);
  if (msg.providerMessageId && (await db.message.findFirst({ where: { providerMessageId: msg.providerMessageId, direction: "IN" }, select: { id: true } }))) return { status: "ignored", brandCode: brand.code };

  if (STOP.test(text)) await optOut(brand.id, { phone });
  const campaign = await campaignForAddress(brand.id, phone);
  let target = await findInboundTarget(brand.id, phone);
  let created = false;
  if (!target) {
    const regionId = await defaultInboundRegion();
    if (!regionId) return { status: "ignored", brandCode: brand.code };
    const [first, ...rest] = (msg.senderName ?? "").trim().split(/\s+/).filter(Boolean);
    const lead = await createLead(
      ctx,
      { firstName: rest.length ? first : undefined, lastName: rest.length ? rest.join(" ") : first || `${CHANNEL_LABELS[msg.channel]} ${phone.slice(-4)}`, mobile: phone, source: msg.channel === "WHATSAPP" ? "WHATSAPP" : "PHONE", sourceDetail: text.slice(0, 300), brandId: brand.id, regionId },
      { autoAssign: true },
    );
    if (campaign) await db.lead.update({ where: { id: lead.id }, data: { campaignId: campaign.campaignId }, select: { id: true } });
    target = { parentType: "Lead", parentId: lead.id, regionId, ownerId: lead.ownerId, contactId: null };
    created = true;
  }
  const activity = await db.activity.create({
    data: {
      type: ACTIVITY_TYPE[msg.channel],
      parentType: target.parentType,
      parentId: target.parentId,
      subject: `${CHANNEL_LABELS[msg.channel]} from ${phone}`,
      description: text,
      status: "COMPLETED",
      completedAt: new Date(),
      dueAt: new Date(),
      direction: "INBOUND",
      phone,
      brandId: brand.id,
      regionId: target.regionId,
      ownerId: target.ownerId,
    },
    select: { id: true },
  });
  await db.message.create({
    data: { channel: msg.channel, direction: "IN", status: "RECEIVED", parentType: target.parentType, parentId: target.parentId, activityId: activity.id, contactId: target.contactId, campaignId: campaign?.campaignId ?? null, fromAddress: phone, toAddress: msg.receiver, body: text, providerMessageId: msg.providerMessageId ?? null, brandId: brand.id, regionId: target.regionId, ownerId: target.ownerId },
    select: { id: true },
  });
  if (campaign) await markResponded(campaign.memberId);
  await notify(ctx, [target.ownerId], { kind: "INFO", title: `New ${CHANNEL_LABELS[msg.channel]} message from ${phone}`, body: text.slice(0, 200), href: `/${target.parentType === "Lead" ? "leads" : "deals"}/${target.parentId}` });
  return { status: created ? "lead_created" : "logged", brandCode: brand.code, parentType: target.parentType, parentId: target.parentId };
}
