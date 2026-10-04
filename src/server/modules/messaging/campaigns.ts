/**
 * Templates and campaigns (prompt 10).
 *   • Templates: group templates (management) and brand templates (the brand's manager).
 *   • Campaigns belong to ONE brand. The audience is built with the CREATOR's access context from that brand's
 *     leads / customers and only contains people with marketing consent FOR THAT BRAND – so an HMNL manager can
 *     never target SNMNL-only customers, and an opt-out for one brand does not affect another.
 *   • Sending needs the massEmail permission, is throttled through the job queue, re-checks consent right
 *     before each message and logs every suppression.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type { Channel, Job, MemberStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { canManageBrandData } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { campaignForWorker, consentFor, finishCampaignIfDone, newToken, pendingMembers } from "@/server/db/messaging-system";
import { BadRequestError } from "@/server/errors";
import { reportRecordIds } from "@/server/modules/reports/engine";
import { getReport } from "@/server/modules/reports/service";
import { automationContext } from "@/server/modules/workflow/engine";
import { isValidEmail, renderMerge, unknownFields } from "./merge";
import { deliver, loadMessageRecord, senderIdentity } from "./service";

// ───────────────────────────── templates ─────────────────────────────

const templateSchema = z.object({
  brandId: z.string().nullish().transform((v) => v || null),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
  name: z.string().trim().min(1, "Name is required").max(120),
  subject: z.string().trim().max(200).nullish().transform((v) => v || null),
  body: z.string().trim().min(1, "The message text is required").max(4000),
  whatsappStatus: z.enum(["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"]).default("NOT_SUBMITTED"),
  whatsappName: z.string().trim().max(120).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
});

/** Brand templates: the brand's manager (or an administrator). Group templates: management / administrators. */
export function canManageTemplate(ctx: AccessContext, brandId: string | null): boolean {
  if (brandId) return canManageBrandData(ctx, "campaigns", "edit", brandId);
  return ctx.isAdmin || (ctx.scope === "ALL" && hasPermission(ctx, "campaigns", "edit"));
}

export async function listTemplates(ctx: AccessContext, filter: { channel?: Channel; brandId?: string | null; activeOnly?: boolean } = {}) {
  assertCan(ctx, "campaigns", "read");
  return scopedDb(ctx).template.findMany({
    where: { ...(filter.channel ? { channel: filter.channel } : {}), ...(filter.brandId ? { OR: [{ brandId: null }, { brandId: filter.brandId }] } : {}), ...(filter.activeOnly ? { active: true } : {}) },
    include: { brand: { select: { code: true } } },
    orderBy: [{ channel: "asc" }, { name: "asc" }],
  });
}

/** Templates a user may pick when writing to a record of this brand (group + the brand's own, active). */
export async function templatesFor(ctx: AccessContext, brandId: string, channel: Channel) {
  return scopedDb(ctx).template.findMany({ where: { channel, active: true, OR: [{ brandId: null }, { brandId }] }, select: { id: true, name: true, subject: true, body: true, whatsappStatus: true }, orderBy: { name: "asc" } });
}

export async function saveTemplate(ctx: AccessContext, id: string | null, input: unknown) {
  const data = templateSchema.parse(input);
  const db = scopedDb(ctx);
  const existing = id ? await db.template.findUnique({ where: { id } }) : null;
  if (id && !existing) throw new NotFoundError();
  // The brand of a template never changes; both the old and the new owner must be manageable.
  const brandId = existing ? existing.brandId : data.brandId;
  if (!canManageTemplate(ctx, brandId)) throw new ForbiddenError(brandId ? "Only the brand's manager can change its templates" : "Group templates are managed by management");
  if (data.channel === "EMAIL" && !data.subject) throw new BadRequestError("An email template needs a subject");
  const values = { channel: data.channel, name: data.name, subject: data.channel === "EMAIL" ? data.subject : null, body: data.body, whatsappStatus: data.channel === "WHATSAPP" ? data.whatsappStatus : "NOT_SUBMITTED", whatsappName: data.channel === "WHATSAPP" ? data.whatsappName : null, active: data.active };
  const saved = existing ? await db.template.update({ where: { id: existing.id }, data: values }) : await db.template.create({ data: { ...values, brandId, createdById: ctx.userId } });
  await audit({ ctx, action: existing ? "UPDATE" : "CREATE", entity: "Template", entityId: saved.id, brandId, before: existing ?? undefined, after: saved });
  return { id: saved.id, unknownFields: unknownFields(`${data.subject ?? ""} ${data.body}`) };
}

export async function deleteTemplate(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const t = await db.template.findUnique({ where: { id }, include: { _count: { select: { campaigns: true } } } });
  if (!t) throw new NotFoundError();
  if (!canManageTemplate(ctx, t.brandId)) throw new ForbiddenError("Only the brand's manager can change its templates");
  // Used templates are kept (campaign history) and only deactivated.
  if (t._count.campaigns > 0) await db.template.update({ where: { id }, data: { active: false } });
  else await db.template.delete({ where: { id } });
  await audit({ ctx, action: "DELETE", entity: "Template", entityId: id, brandId: t.brandId, before: t });
}

// ───────────────────────────── campaigns ─────────────────────────────

export const CAMPAIGN_TYPES = { LAUNCH: "Launch", PROMO: "Promotion", SERVICE_REMINDER: "Service reminder", EVENT: "Event" } as const;
export const AUDIENCES = { ALL_LEADS: "Open leads of the brand", ALL_CUSTOMERS: "Customers of the brand (contacts on its deals)", REPORT: "Records of a saved report (leads or deals)" } as const;
export const MEMBER_LABELS: Record<MemberStatus, string> = { PENDING: "Pending", SENT: "Sent", DELIVERED: "Delivered", OPENED: "Opened", CLICKED: "Clicked", RESPONDED: "Responded", UNSUBSCRIBED: "Unsubscribed", FAILED: "Failed", SUPPRESSED: "Suppressed" };

const date = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.date().nullable());
const campaignSchema = z.object({
  brandId: z.string().min(1, "Brand is required"),
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["LAUNCH", "PROMO", "SERVICE_REMINDER", "EVENT"]).default("PROMO"),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
  budget: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable()),
  startDate: date,
  endDate: date,
  templateId: z.string().nullish().transform((v) => v || null),
  audience: z.object({ kind: z.enum(["ALL_LEADS", "ALL_CUSTOMERS", "REPORT"]), reportId: z.string().nullish() }).default({ kind: "ALL_LEADS" }),
});

async function assertTemplate(ctx: AccessContext, templateId: string | null, brandId: string, channel: Channel) {
  if (!templateId) return;
  const t = await scopedDb(ctx).template.findFirst({ where: { id: templateId, channel, active: true, OR: [{ brandId: null }, { brandId }] }, select: { id: true } });
  if (!t) throw new BadRequestError("Choose a template of this brand (or a group template) for the campaign's channel");
}

export async function createCampaign(ctx: AccessContext, input: unknown) {
  assertCan(ctx, "campaigns", "create");
  const data = campaignSchema.parse(input);
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(data.brandId)) throw new ForbiddenError("You can only create campaigns for your own brands");
  const db = scopedDb(ctx);
  const brand = await db.brand.findUnique({ where: { id: data.brandId }, select: { code: true, status: true } });
  if (!brand || brand.status !== "ACTIVE") throw new BadRequestError("Campaigns need an active brand");
  await assertTemplate(ctx, data.templateId, data.brandId, data.channel);
  const code = `${brand.code}-${new Date().toISOString().slice(2, 7).replace("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const c = await db.campaign.create({ data: { ...data, audience: data.audience as Prisma.InputJsonValue, code, ownerId: ctx.userId, createdById: ctx.userId }, select: { id: true, code: true } });
  await audit({ ctx, action: "CREATE", entity: "Campaign", entityId: c.id, brandId: data.brandId, after: { ...data, code } });
  return c;
}

/** 404 for campaigns of brands the viewer does not belong to. */
export async function getCampaign(ctx: AccessContext, id: string) {
  assertCan(ctx, "campaigns", "read");
  const c = await scopedDb(ctx).campaign.findUnique({ where: { id }, include: { template: true, brand: { select: { code: true, name: true } } } });
  if (!c) throw new NotFoundError();
  return c;
}

export async function listCampaigns(ctx: AccessContext, filter: { brandId?: string | null } = {}) {
  assertCan(ctx, "campaigns", "read");
  return scopedDb(ctx).campaign.findMany({ where: filter.brandId ? { brandId: filter.brandId } : {}, include: { _count: { select: { members: true } }, template: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function updateCampaign(ctx: AccessContext, id: string, input: unknown) {
  assertCan(ctx, "campaigns", "edit");
  const current = await getCampaign(ctx, id);
  if (current.status !== "DRAFT") throw new BadRequestError("Only draft campaigns can be changed");
  const data = campaignSchema.parse({ ...(input as object), brandId: current.brandId });
  await assertTemplate(ctx, data.templateId, current.brandId, data.channel);
  const db = scopedDb(ctx);
  // Another channel or audience invalidates the members that were built.
  if (data.channel !== current.channel || JSON.stringify(data.audience) !== JSON.stringify(current.audience)) await db.campaignMember.deleteMany({ where: { campaignId: id } });
  await db.campaign.update({ where: { id }, data: { name: data.name, type: data.type, channel: data.channel, budget: data.budget, startDate: data.startDate, endDate: data.endDate, templateId: data.templateId, audience: data.audience as Prisma.InputJsonValue } });
  return { id };
}

interface Candidate {
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  consent: boolean | null;
}

/**
 * Builds the member list of a draft campaign with the CREATOR's access context. Candidates come from the
 * brand's records the creator can see; only those with marketing consent for this brand become PENDING, the
 * rest are logged as SUPPRESSED with the reason.
 */
export async function buildAudience(ctx: AccessContext, id: string) {
  assertCan(ctx, "campaigns", "edit");
  const campaign = await getCampaign(ctx, id);
  if (campaign.status !== "DRAFT") throw new BadRequestError("The audience of a launched campaign cannot be rebuilt");
  const db = scopedDb(ctx);
  const audience = (campaign.audience ?? {}) as { kind?: string; reportId?: string | null };
  let kind = audience.kind ?? "ALL_LEADS";
  let ids: string[] | null = null;
  if (kind === "REPORT") {
    if (!audience.reportId) throw new BadRequestError("Choose the saved report that selects the audience");
    const report = await getReport(ctx, audience.reportId); // 404 when the creator cannot open it
    if (report.definition.special || (report.module !== "leads" && report.module !== "deals")) throw new BadRequestError("Use a report on leads or deals as the audience");
    ids = await reportRecordIds(ctx, report.definition, { brandId: campaign.brandId });
    kind = report.module === "leads" ? "ALL_LEADS" : "ALL_CUSTOMERS";
  }
  const candidates: Candidate[] = [];
  if (kind === "ALL_LEADS") {
    const leads = await db.lead.findMany({
      where: { brandId: campaign.brandId, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] }, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, firstName: true, lastName: true, mobile: true, email: true, consentMarketing: true, consentAt: true },
      take: 20_000,
    });
    for (const l of leads) candidates.push({ contactId: null, leadId: l.id, dealId: null, name: [l.firstName, l.lastName].filter(Boolean).join(" "), mobile: l.mobile, email: l.email, consent: l.consentMarketing ? true : l.consentAt ? false : null });
  } else {
    // Customers of THIS brand = contacts on the brand's deals the creator can see.
    const deals = await db.deal.findMany({
      where: { brandId: campaign.brandId, contactId: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, contact: { select: { id: true, firstName: true, lastName: true, mobile: true, email: true, deletedAt: true, consents: { where: { brandId: campaign.brandId }, select: { consent: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 20_000,
    });
    const seen = new Set<string>();
    for (const d of deals) {
      const c = d.contact;
      if (!c || c.deletedAt || seen.has(c.id)) continue;
      seen.add(c.id);
      candidates.push({ contactId: c.id, leadId: null, dealId: d.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), mobile: c.mobile, email: c.email, consent: c.consents[0]?.consent ?? null });
    }
  }
  const members: Prisma.CampaignMemberCreateManyInput[] = [];
  const addresses = new Set<string>();
  let noAddress = 0;
  for (const c of candidates) {
    const address = campaign.channel === "EMAIL" ? (c.email && isValidEmail(c.email) ? c.email.toLowerCase() : null) : normalizePhone(c.mobile);
    if (!address) {
      noAddress++;
      continue;
    }
    if (addresses.has(address)) continue;
    addresses.add(address);
    members.push({
      campaignId: id,
      contactId: c.contactId,
      leadId: c.leadId,
      dealId: c.dealId,
      name: c.name || address,
      address,
      status: c.consent === true ? "PENDING" : "SUPPRESSED",
      reason: c.consent === true ? null : c.consent === false ? `Opted out of ${campaign.brand.code} marketing` : `No marketing consent recorded for ${campaign.brand.code}`,
      unsubscribeToken: newToken(),
    });
  }
  await db.campaignMember.deleteMany({ where: { campaignId: id } });
  if (members.length) await db.campaignMember.createMany({ data: members });
  const pending = members.filter((m) => m.status === "PENDING").length;
  return { candidates: candidates.length, pending, suppressed: members.length - pending, noAddress };
}

const BATCH = 25;
export const unsubscribeUrl = (token: string) => `${(process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/public/unsubscribe/${token}`;

/**
 * Launch: needs the massEmail permission (Brand Manager and above), a template, the brand's sender identity
 * and at least one member with consent. Sending is throttled: batches of 25 spread over the job queue at
 * MESSAGING_RATE_PER_MINUTE (default 120).
 */
export async function launchCampaign(ctx: AccessContext, id: string) {
  assertCan(ctx, "campaigns", "massEmail");
  const campaign = await getCampaign(ctx, id);
  if (campaign.status !== "DRAFT") throw new BadRequestError("This campaign was already launched");
  if (!campaign.template || !campaign.template.active) throw new BadRequestError("Choose a template before launching");
  if (campaign.channel === "WHATSAPP" && (campaign.template.whatsappStatus !== "APPROVED" || !campaign.template.whatsappName)) throw new BadRequestError("WhatsApp campaigns need a template approved by WhatsApp");
  const db = scopedDb(ctx);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: campaign.brandId } });
  senderIdentity(brand, campaign.channel); // 400 when the brand has no sender for this channel
  const pending = await db.campaignMember.count({ where: { campaignId: id, status: "PENDING" } });
  if (pending === 0) throw new BadRequestError("Build the audience first – there is nobody with marketing consent to send to");
  await db.campaign.update({ where: { id }, data: { status: "SENDING", launchedAt: new Date() } });
  const perMinute = Math.max(1, Number(process.env.MESSAGING_RATE_PER_MINUTE ?? 120));
  const batches = Math.ceil(pending / BATCH);
  for (let i = 0; i < batches; i++) {
    await enqueueJob({ type: "campaign.batch", payload: { campaignId: id, batch: i }, brandId: campaign.brandId, idempotencyKey: `campaign:${id}:${i}`, runAt: new Date(Date.now() + Math.floor((i * BATCH * 60_000) / perMinute)) });
  }
  await audit({ ctx, action: "UPDATE", entity: "Campaign", entityId: id, brandId: campaign.brandId, after: { launched: true, pending, batches } });
  return { pending, batches };
}

export async function cancelCampaign(ctx: AccessContext, id: string) {
  assertCan(ctx, "campaigns", "edit");
  const campaign = await getCampaign(ctx, id);
  if (campaign.status === "SENT" || campaign.status === "CANCELLED") throw new BadRequestError("This campaign is already finished");
  await scopedDb(ctx).campaign.update({ where: { id }, data: { status: "CANCELLED" } });
}

/** Job handler: sends the next batch. Consent is checked again right before each message. */
export async function processCampaignBatch(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { campaignId } = job.payload as { campaignId: string };
  const campaign = await campaignForWorker(campaignId);
  if (!campaign || campaign.status !== "SENDING" || !campaign.template) return { skipped: "campaign is not being sent" };
  const ctx = automationContext(campaign.brandId);
  const db = scopedDb(ctx);
  const counts = { sent: 0, failed: 0, suppressed: 0 };
  for (const m of await pendingMembers(campaignId, BATCH)) {
    const set = (status: MemberStatus, extra: Prisma.CampaignMemberUpdateInput = {}) => db.campaignMember.update({ where: { id: m.id }, data: { status, ...extra } });
    if ((await consentFor(campaign.brandId, m)) !== true) {
      await set("SUPPRESSED", { reason: `Opted out of ${campaign.brand.code} marketing before sending` });
      counts.suppressed++;
      continue;
    }
    try {
      const record = m.leadId ? await loadMessageRecord(ctx, "Lead", m.leadId) : await loadMessageRecord(ctx, "Deal", m.dealId ?? "");
      const url = unsubscribeUrl(m.unsubscribeToken);
      const template = campaign.template;
      let body = renderMerge(template.body, record.merge, { unsubscribeUrl: url });
      // Every marketing message carries the brand's opt-out.
      if (campaign.channel === "EMAIL" && !template.body.includes("unsubscribeUrl")) body += `\n\nYou receive this because you agreed to hear from ${campaign.brand.name}. Unsubscribe: ${url}`;
      if (campaign.channel !== "EMAIL" && !/\bSTOP\b/.test(body)) body += " Reply STOP to opt out.";
      const res = await deliver(ctx, {
        channel: campaign.channel,
        record,
        to: m.address,
        subject: renderMerge(template.subject ?? campaign.name, record.merge),
        body,
        templateId: template.id,
        whatsappTemplate: campaign.channel === "WHATSAPP" ? { name: template.whatsappName!, parameters: [record.recipient.firstName ?? record.recipient.name] } : null,
        campaignId,
        campaignMemberId: m.id,
        unsubscribeUrl: url,
      });
      if (res.status === "SENT") {
        await set("SENT", { messageId: res.id, sentAt: new Date() });
        counts.sent++;
      } else {
        await set("FAILED", { messageId: res.id, reason: res.error });
        counts.failed++;
      }
    } catch (err) {
      await set("FAILED", { reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      counts.failed++;
    }
  }
  return { ...counts, finished: await finishCampaignIfDone(campaignId) };
}

/** Member funnel and ROI (leads / deals attributed to the campaign – as far as the viewer may see them). */
export async function campaignStats(ctx: AccessContext, id: string) {
  const campaign = await getCampaign(ctx, id);
  const db = scopedDb(ctx);
  const [byStatus, leads, deals, won] = await Promise.all([
    db.campaignMember.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    db.lead.count({ where: { campaignId: id } }),
    db.deal.count({ where: { campaignId: id } }),
    db.deal.aggregate({ where: { campaignId: id, stage: { type: "WON" } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const members = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<MemberStatus, number>>;
  const n = (s: MemberStatus) => members[s] ?? 0;
  const reached = n("SENT") + n("DELIVERED") + n("OPENED") + n("CLICKED") + n("RESPONDED") + n("UNSUBSCRIBED");
  const revenue = Number(won._sum.amount ?? 0);
  const budget = campaign.budget === null ? null : Number(campaign.budget.toString());
  return {
    members,
    total: Object.values(members).reduce((a, b) => a + (b ?? 0), 0),
    reached,
    leads,
    deals,
    wonDeals: won._count._all,
    revenue,
    budget,
    /** return on investment in percent: (won revenue − budget) ÷ budget */
    roi: budget && budget > 0 ? Math.round(((revenue - budget) * 1000) / budget) / 10 : null,
  };
}

export async function campaignMembers(ctx: AccessContext, id: string, opts: { status?: MemberStatus; take?: number; skip?: number } = {}) {
  await getCampaign(ctx, id);
  const where = { campaignId: id, ...(opts.status ? { status: opts.status } : {}) };
  const db = scopedDb(ctx);
  const [rows, total] = await Promise.all([db.campaignMember.findMany({ where, orderBy: [{ status: "asc" }, { name: "asc" }], take: Math.min(opts.take ?? 50, 500), skip: opts.skip ?? 0 }), db.campaignMember.count({ where })]);
  return { rows, total };
}
