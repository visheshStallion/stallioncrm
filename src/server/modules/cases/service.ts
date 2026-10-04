/**
 * Cases – customer care & complaints (prompt 11). Cases are brand-owned: created through scopedDb with the
 * brand and region of the linked deal (or an explicit brand context), numbered per brand by the DB trigger and
 * visible only to that brand's territory – an HMNL agent never sees an SNMNL case.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type { CasePriority, Prisma } from "@prisma/client";
import { normalizePhone } from "@/lib/phone";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { stripUneditable } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { canWriteTo, isManagerOf } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { contactByAddress } from "@/server/db/cases-system";
import { defaultInboundRegion } from "@/server/db/messaging-system";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { usersWhoCanSee } from "@/server/modules/activities/queries";
import { prepareCustomFields } from "@/server/modules/customization/service";
import { assignRecord } from "@/server/modules/leads/assignment";
import { notify } from "@/server/modules/notifications/service";
import { automationContext } from "@/server/modules/workflow/engine";
import { addBusinessHours } from "./business-hours";
import { getCase, loadCalendar } from "./queries";
import { createCaseSchema, OPEN_STATUSES, publicCaseSchema, statusSchema, STATUS_LABELS, updateCaseSchema, type CaseStatusKey, type CreateCaseInput, type UpdateCaseInput } from "./schema";

/** First-response and resolution due times from the brand's SLA policy, in business hours. */
async function slaDates(ctx: AccessContext, brandId: string, priority: CasePriority, from: Date) {
  const db = scopedDb(ctx);
  const [policy, calendar] = await Promise.all([db.slaPolicy.findUnique({ where: { brandId_priority: { brandId, priority } } }), loadCalendar(ctx)]);
  if (!policy) return { firstResponseDueAt: null, slaDueAt: null };
  return { firstResponseDueAt: addBusinessHours(from, policy.firstResponseHours, calendar), slaDueAt: addBusinessHours(from, policy.resolutionHours, calendar) };
}

/**
 * Creates a case. With a deal, brand / region / customer come from the deal (404 when the deal is hidden);
 * without one the caller names a brand-region they work in. `autoAssign` (public form, inbound messages)
 * uses the assignment engine: round-robin in the brand-region, else the manager – then the case is "unassigned".
 */
export async function createCase(ctx: AccessContext, input: CreateCaseInput, opts: { autoAssign?: boolean } = {}) {
  const data = createCaseSchema.parse(input);
  const db = scopedDb(ctx);
  let { brandId, regionId } = data;
  let accountId = data.accountId;
  let contactId = data.contactId;
  if (data.dealId) {
    const deal = await db.deal.findUnique({ where: { id: data.dealId }, select: { brandId: true, regionId: true, accountId: true, contactId: true } });
    if (!deal) throw new NotFoundError();
    brandId = deal.brandId;
    regionId = deal.regionId;
    accountId ??= deal.accountId;
    contactId ??= deal.contactId;
  }
  if (!brandId || !regionId) throw new BadRequestError("Choose the brand and region of the case");
  if (!canWriteTo(ctx, brandId, regionId)) throw new ForbiddenError("You cannot create cases for this brand/region");
  assertCan(ctx, "cases", "create", { brandId, regionId });
  if (contactId) {
    const contact = await db.contact.findFirst({ where: { id: contactId, deletedAt: null }, select: { accountId: true } });
    if (!contact) throw new BadRequestError("Unknown contact");
    accountId ??= contact.accountId;
  }
  if (accountId && !(await db.account.findFirst({ where: { id: accountId, deletedAt: null }, select: { id: true } }))) throw new BadRequestError("Unknown account");

  let ownerId = data.ownerId ?? (ctx.system || opts.autoAssign ? null : ctx.userId);
  let unassigned = false;
  if (!ownerId) {
    const decision = await assignRecord(ctx, "cases", { brandId, regionId, source: "", modelOfInterestId: null });
    ownerId = decision.userId;
    // Nobody in the brand-region to take it: parked with the manager in the "Unassigned" queue.
    unassigned = decision.via === "territory-manager" || decision.via === "brand-manager";
  }
  if (!ownerId) throw new BadRequestError("No user is available to own this case – add members to the brand-region territory");

  const now = new Date();
  const customFields = await prepareCustomFields(ctx, "cases", brandId, data, (input as { customFields?: unknown }).customFields);
  const created = await db.case.create({
    data: {
      customFields,
      subject: data.subject,
      description: data.description,
      type: data.type,
      priority: data.priority,
      channel: data.channel,
      accountId,
      contactId,
      dealId: data.dealId,
      salesOrderId: data.salesOrderId,
      vin: data.vin,
      customerName: data.customerName,
      customerPhone: normalizePhone(data.customerPhone) ?? data.customerPhone,
      customerEmail: data.customerEmail,
      unassigned,
      ...(await slaDates(ctx, brandId, data.priority, now)),
      brandId,
      regionId,
      ownerId,
    } satisfies Prisma.CaseUncheckedCreateInput,
    select: { id: true, number: true, ownerId: true },
  });
  if (created.ownerId !== ctx.userId) await notify(ctx, [created.ownerId], { kind: "ASSIGNED", title: `Case ${created.number}: ${data.subject}`, body: unassigned ? "Unassigned – nobody in the territory could take it" : "Assigned to you", href: `/cases/${created.id}` });
  return created;
}

async function loadEditable(ctx: AccessContext, id: string) {
  const c = await getCase(ctx, id);
  assertCan(ctx, "cases", "edit", c);
  return c;
}

export async function updateCase(ctx: AccessContext, id: string, input: UpdateCaseInput) {
  const current = await loadEditable(ctx, id);
  const data = updateCaseSchema.parse(stripUneditable(ctx, "cases", input)); // field-level security on writes
  const db = scopedDb(ctx);
  if (data.dealId && data.dealId !== current.dealId) {
    const deal = await db.deal.findUnique({ where: { id: data.dealId }, select: { brandId: true } });
    if (!deal || deal.brandId !== current.brandId) throw new BadRequestError("The deal must belong to the case's brand");
  }
  // A new priority restarts the SLA clock from the case's creation.
  const sla = data.priority && data.priority !== current.priority ? await slaDates(ctx, current.brandId, data.priority, new Date(current.createdAt)) : {};
  const stored = await db.case.findUniqueOrThrow({ where: { id: current.id }, select: { customFields: true } });
  const customFields = await prepareCustomFields(ctx, "cases", current.brandId, { ...current, ...data }, (input as { customFields?: unknown }).customFields, stored.customFields);
  await db.case.update({ where: { id: current.id }, data: { ...data, customFields, ...(data.customerPhone ? { customerPhone: normalizePhone(data.customerPhone) ?? data.customerPhone } : {}), ...sla }, select: { id: true } });
  return { id: current.id };
}

/**
 * Status change. Leaving New counts as the first response; Resolved needs a resolution; Closed sends the
 * satisfaction survey. Reopening a closed case is for managers.
 */
export async function changeCaseStatus(ctx: AccessContext, id: string, input: { status: string; resolution?: string | null }) {
  const current = await loadEditable(ctx, id);
  const { status, resolution } = statusSchema.parse(input);
  if (status === current.status) return { id: current.id, status };
  const now = new Date();
  const wasOpen = current.open;
  const willBeOpen = (OPEN_STATUSES as string[]).includes(status);
  if (current.status === "CLOSED" && willBeOpen && !isManagerOf(ctx, current.brandId, current.regionId)) throw new ForbiddenError("Only a manager can reopen a closed case");
  const text = resolution ?? current.resolution;
  if (!willBeOpen && !text) throw new BadRequestError("Describe the resolution before resolving or closing the case");
  const data: Prisma.CaseUncheckedUpdateInput = { status: status as CaseStatusKey };
  if (status !== "NEW" && !current.firstRespondedAt) data.firstRespondedAt = now;
  if (!willBeOpen) {
    data.resolution = text;
    if (!current.resolvedAt) data.resolvedAt = now;
    if (status === "CLOSED") data.closedAt = now;
  } else if (!wasOpen) {
    // reopened
    data.resolvedAt = null;
    data.closedAt = null;
  }
  await scopedDb(ctx).case.update({ where: { id: current.id }, data, select: { id: true } });
  let survey = false;
  if (status === "CLOSED") survey = await sendSurvey(ctx, current.id).catch((err) => (logger.warn({ err, caseId: current.id }, "survey could not be sent"), false));
  return { id: current.id, status, survey };
}

/** "Take" an unassigned case, or (managers / the owner) hand it to a colleague who works in the brand-region. */
export async function assignCase(ctx: AccessContext, id: string, ownerId?: string | null) {
  const current = await loadEditable(ctx, id);
  const target = ownerId || ctx.userId;
  if (target !== ctx.userId && current.ownerId !== ctx.userId && !isManagerOf(ctx, current.brandId, current.regionId)) throw new ForbiddenError("Only the owner or a manager can reassign a case");
  await scopedDb(ctx).case.update({ where: { id: current.id }, data: { ownerId: target, unassigned: false }, select: { id: true } });
  if (target !== ctx.userId) await notify(ctx, [target], { kind: "ASSIGNED", title: `Case ${current.number}: ${current.subject}`, body: `Assigned by ${ctx.user.name}`, href: `/cases/${current.id}` });
  return { id: current.id, ownerId: target };
}

/**
 * SLA escalation (called by the workflow rule "Case breaching its SLA" with a system context bound to the
 * case's brand): marks the case Escalated and notifies the role of its SLA policy – only users of that role
 * who can see the case, i.e. the Brand Manager of the CASE'S brand, never another brand's.
 */
export async function escalateCase(ctx: AccessContext, id: string): Promise<string> {
  const db = scopedDb(ctx);
  const c = await db.case.findUnique({ where: { id }, select: { id: true, number: true, subject: true, status: true, priority: true, brandId: true, regionId: true, ownerId: true, escalatedAt: true } });
  if (!c) return "skipped: case not found";
  if (c.escalatedAt || !(OPEN_STATUSES as string[]).includes(c.status)) return "skipped: already escalated or closed";
  const policy = await db.slaPolicy.findUnique({ where: { brandId_priority: { brandId: c.brandId, priority: c.priority } }, select: { escalateToRole: true } });
  const role = policy?.escalateToRole ?? "Brand Manager";
  const visible = new Set((await usersWhoCanSee(ctx, c.brandId, c.regionId)).map((u) => u.id));
  let recipients = (await db.user.findMany({ where: { active: true, role: { name: role } }, select: { id: true } })).map((u) => u.id).filter((u) => visible.has(u));
  if (recipients.length === 0) {
    // fall back to the brand's manager so that an escalation is never lost
    const brand = await db.brand.findUnique({ where: { id: c.brandId }, select: { brandManagerId: true } });
    recipients = brand?.brandManagerId ? [brand.brandManagerId] : [];
  }
  await db.case.update({ where: { id }, data: { status: "ESCALATED", escalatedAt: new Date() }, select: { id: true } });
  await notify(ctx, [...new Set([...recipients, c.ownerId])], { kind: "SLA", title: `SLA breached: case ${c.number}`, body: c.subject, href: `/cases/${c.id}` });
  return `escalated to ${recipients.length} ${role}`;
}

export const surveyUrl = (token: string) => `${(process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/public/csat/${token}`;

/** Sends the satisfaction survey (email, else SMS) as the case's brand. False when there is no way to reach the customer. */
export async function sendSurvey(ctx: AccessContext, caseId: string): Promise<boolean> {
  const db = scopedDb(ctx);
  const c = await db.case.findUnique({ where: { id: caseId }, select: { id: true, number: true, surveyToken: true, surveySentAt: true, satisfactionScore: true } });
  if (!c || c.surveySentAt || c.satisfactionScore !== null) return false;
  // Lazy import: the messaging module loads cases for its merge data.
  const { deliver, loadMessageRecord } = await import("@/server/modules/messaging/service");
  const { renderMerge } = await import("@/server/modules/messaging/merge");
  const record = await loadMessageRecord(ctx, "Case", caseId);
  const channel = record.recipient.email ? "EMAIL" : record.recipient.mobile ? "SMS" : null;
  if (!channel) return false;
  const token = c.surveyToken ?? randomBytes(24).toString("base64url");
  const template = await db.template.findFirst({ where: { channel, active: true, name: { equals: "Case satisfaction survey", mode: "insensitive" }, OR: [{ brandId: record.brandId }, { brandId: null }] }, orderBy: { brandId: { sort: "desc", nulls: "last" } } });
  const url = surveyUrl(token);
  const body = template
    ? renderMerge(template.body, record.merge, { surveyUrl: url })
    : `Dear ${record.recipient.firstName ?? record.recipient.name}, your case ${c.number} has been closed. How satisfied are you with how ${String(record.merge.brand?.name ?? "we")} handled it? ${url}`;
  await db.case.update({ where: { id: caseId }, data: { surveyToken: token }, select: { id: true } });
  const res = await deliver(ctx, { channel, record, subject: template?.subject ? renderMerge(template.subject, record.merge) : `How did we do? Case ${c.number}`, body: body.includes(url) ? body : `${body} ${url}`, templateId: template?.id ?? null }).catch(() => null);
  if (res?.status !== "SENT") return false;
  await db.case.update({ where: { id: caseId }, data: { surveySentAt: new Date() }, select: { id: true } });
  return true;
}

/** Turns an inbound message (WhatsApp / SMS log on a lead or deal) into a case of the same brand. */
export async function createCaseFromActivity(ctx: AccessContext, activityId: string, input: { subject?: string; type?: string; priority?: string } = {}) {
  const db = scopedDb(ctx);
  const a = await db.activity.findUnique({ where: { id: activityId }, select: { type: true, subject: true, description: true, phone: true, parentType: true, parentId: true, brandId: true, regionId: true, direction: true } });
  if (!a) throw new NotFoundError();
  if (!["WHATSAPP_LOG", "SMS_LOG", "EMAIL_LOG", "CALL"].includes(a.type)) throw new BadRequestError("Cases are created from calls and messages");
  const lead = a.parentType === "Lead" ? await db.lead.findUnique({ where: { id: a.parentId }, select: { firstName: true, lastName: true, mobile: true, email: true } }) : null;
  return createCase(ctx, {
    subject: input.subject?.trim() || a.subject,
    description: a.description,
    type: input.type,
    priority: input.priority,
    channel: a.type === "WHATSAPP_LOG" ? "WHATSAPP" : a.type === "EMAIL_LOG" ? "EMAIL" : "PHONE",
    ...(a.parentType === "Deal" ? { dealId: a.parentId } : { brandId: a.brandId, regionId: a.regionId }),
    customerName: lead ? [lead.firstName, lead.lastName].filter(Boolean).join(" ") : undefined,
    customerPhone: lead?.mobile ?? a.phone ?? undefined,
    customerEmail: lead?.email ?? undefined,
  } as CreateCaseInput);
}

/**
 * Public case form / email-to-case gateway: POST /api/public/cases/<BRAND>. The brand comes from the URL only.
 * A known customer (phone or email) is linked; the case is assigned by the brand's assignment rules.
 */
export async function intakeCase(brandCode: string, raw: unknown, channel: "WEB" | "EMAIL" = "WEB"): Promise<{ status: "created" | "ignored"; number?: string }> {
  const payload = publicCaseSchema.parse(raw);
  if (payload.website) return { status: "ignored" }; // honeypot
  const lookup = scopedDb(automationContext("", "ALL"));
  const brand = await lookup.brand.findUnique({ where: { code: brandCode.toUpperCase() }, select: { id: true, status: true } });
  if (!brand || brand.status !== "ACTIVE") throw new BadRequestError("Unknown brand");
  const region = payload.region ? await lookup.region.findFirst({ where: { active: true, name: { equals: payload.region, mode: "insensitive" } }, select: { id: true } }) : null;
  const regionId = region?.id ?? (await defaultInboundRegion());
  if (!regionId) throw new BadRequestError("Unknown region");
  const phone = normalizePhone(payload.phone);
  const contact = await contactByAddress(phone, payload.email);
  // Rules may react to new cases (automation: false), but everything stays inside this one brand.
  const ctx: AccessContext = { ...automationContext(brand.id), automation: false, user: { name: "Case intake", email: "", roleName: "System" } };
  const created = await createCase(
    ctx,
    { subject: payload.subject, description: payload.message, type: payload.type, channel, brandId: brand.id, regionId, contactId: contact?.id, accountId: contact?.accountId ?? undefined, customerName: payload.name, customerPhone: phone ?? payload.phone ?? undefined, customerEmail: payload.email ?? undefined, vin: payload.vin ?? undefined },
    { autoAssign: true },
  );
  return { status: "created", number: created.number };
}

export { STATUS_LABELS };
