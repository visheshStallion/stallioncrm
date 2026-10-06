import "server-only";
import type { Prisma } from "@prisma/client";
import { toCsv } from "@/lib/csv";
import { assertCan, can } from "@/server/access/can";
import { assertSameBrand } from "@/server/access/brand-tag";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { stripUneditable } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { moveLeadActivitiesToDeal } from "@/server/modules/activities/service";
import { prepareCustomFields } from "@/server/modules/customization/service";
import { assignLead } from "./assignment";
import { leadName, leadWhere, listLeads } from "./queries";
import {
  createLeadSchema,
  SETTABLE_STATUSES,
  updateLeadSchema,
  type CreateLeadInput,
  type LeadFilters,
  type UpdateLeadInput,
} from "./schema";

/** A model of interest must belong to the lead's brand. */
async function assertProductOfBrand(ctx: AccessContext, productId: string | null | undefined, brandId: string) {
  if (!productId) return;
  const p = await scopedDb(ctx).product.findUnique({ where: { id: productId }, select: { brandId: true } });
  assertSameBrand(brandId, p?.brandId, "The model");
}

/**
 * Creates a lead. Owner: explicit `ownerId`, or the assignment rules when `autoAssign`, else the creator.
 * scopedDb enforces brand/region access, inactive brands and owner eligibility.
 */
export async function createLead(ctx: AccessContext, input: CreateLeadInput, opts: { autoAssign?: boolean } = {}) {
  const data = createLeadSchema.parse(input);
  assertCan(ctx, "leads", "create", { brandId: data.brandId, regionId: data.regionId });
  await assertProductOfBrand(ctx, data.modelOfInterestId, data.brandId);

  let ownerId = data.ownerId ?? (ctx.system ? null : ctx.userId);
  if (opts.autoAssign || !ownerId) {
    const decision = await assignLead(ctx, {
      brandId: data.brandId,
      regionId: data.regionId,
      source: data.source,
      modelOfInterestId: data.modelOfInterestId,
    });
    ownerId = decision.userId ?? ownerId;
  }
  if (!ownerId) throw new BadRequestError("No user is available to own this lead – configure an assignment rule");
  const customFields = await prepareCustomFields(ctx, "leads", data.brandId, data, (input as { customFields?: unknown }).customFields);

  return scopedDb(ctx).lead.create({
    data: {
      ...data,
      customFields,
      ownerId,
      consentAt: data.consentMarketing ? new Date() : null,
      utm: undefined,
    },
    select: { id: true, ownerId: true },
  });
}

async function loadVisible(ctx: AccessContext, id: string) {
  const lead = await scopedDb(ctx).lead.findUnique({
    where: { id },
    select: { id: true, brandId: true, regionId: true, ownerId: true, status: true, consentMarketing: true },
  });
  if (!lead) throw new NotFoundError();
  return lead;
}

export async function updateLead(ctx: AccessContext, id: string, input: UpdateLeadInput) {
  input = stripUneditable(ctx, "leads", input); // field-level security: read-only / hidden fields cannot be changed
  const data = updateLeadSchema.parse(input);
  const current = await loadVisible(ctx, id);
  assertCan(ctx, "leads", "edit", current);
  if (current.status === "CONVERTED") throw new ForbiddenError("Converted leads are read-only");
  await assertProductOfBrand(ctx, data.modelOfInterestId, current.brandId);
  const stored = await scopedDb(ctx).lead.findUniqueOrThrow({ where: { id } });
  const customFields = await prepareCustomFields(ctx, "leads", current.brandId, { ...stored, ...data }, (input as { customFields?: unknown }).customFields, stored.customFields);
  return scopedDb(ctx).lead.update({
    where: { id },
    data: {
      ...data,
      customFields,
      ...(data.consentMarketing !== undefined && data.consentMarketing !== current.consentMarketing
        ? { consentAt: data.consentMarketing ? new Date() : null }
        : {}),
      ...(data.status && data.status !== "UNQUALIFIED" ? { unqualifiedReason: null } : {}),
    },
    select: { id: true },
  });
}

/** Single owner change (edit permission). The new owner must have access to the lead's brand-region. */
export async function changeLeadOwner(ctx: AccessContext, id: string, ownerId: string) {
  const current = await loadVisible(ctx, id);
  assertCan(ctx, "leads", "edit", current);
  return scopedDb(ctx).lead.update({ where: { id }, data: { ownerId }, select: { id: true } });
}

/** Mass actions need the massUpdate permission; only leads visible to the user are touched. */
export async function massChangeOwner(ctx: AccessContext, ids: string[], ownerId: string) {
  assertCan(ctx, "leads", "massUpdate");
  if (ids.length === 0) return { count: 0 };
  // Same brand only: every selected lead must be in one brand.
  const brands = await scopedDb(ctx).lead.findMany({ where: { id: { in: ids } }, distinct: ["brandId"], select: { brandId: true } });
  if (brands.length > 1) throw new BadRequestError("Change owner works within one brand at a time – select leads of a single brand");
  return scopedDb(ctx).lead.updateMany({ where: { id: { in: ids }, status: { not: "CONVERTED" } }, data: { ownerId } });
}

export async function massUpdateStatus(ctx: AccessContext, ids: string[], status: (typeof SETTABLE_STATUSES)[number], reason?: string | null) {
  assertCan(ctx, "leads", "massUpdate");
  if (!SETTABLE_STATUSES.includes(status)) throw new BadRequestError("Invalid status");
  if (status === "UNQUALIFIED" && !reason) throw new BadRequestError("Give a reason when marking leads unqualified");
  return scopedDb(ctx).lead.updateMany({
    where: { id: { in: ids }, status: { not: "CONVERTED" } },
    data: { status, unqualifiedReason: status === "UNQUALIFIED" ? reason : null },
  });
}

/** CSV export of the filtered (or selected) leads – export permission only; audited. */
export async function exportLeads(ctx: AccessContext, filters: LeadFilters, ids?: string[]) {
  assertCan(ctx, "leads", "export");
  const { rows, total } = await listLeads(ctx, filters, { take: 5000, ids });
  await audit({ ctx, action: "EXPORT", entity: "Lead", after: { filters, ids: ids?.length ?? null, rows: rows.length, total } });
  return toCsv(
    ["id", "name", "mobile", "email", "city", "brandId", "regionId", "source", "status", "rating", "model", "owner", "createdAt"],
    rows.map((r) => [r.id, r.name, r.mobile, r.email, r.city, r.brandId, r.regionId, r.source, r.status, r.rating, r.modelName, r.ownerName, r.createdAt]),
  );
}

export interface ConvertInput {
  account:
    | { mode: "new"; type: "INDIVIDUAL" | "CORPORATE" | "GOVERNMENT" | "FLEET"; name?: string | null; forceNew?: boolean }
    | { mode: "existing"; accountId: string };
  contact: { mode: "new" } | { mode: "existing"; contactId: string };
  deal: { name: string; amount?: number | null; closeDate?: string | null };
}

/**
 * Lead conversion (prompt 02 §6, prompt 03 §5): links the shared customer – REUSING an existing contact /
 * account with the same mobile or email instead of creating a duplicate – creates a Deal with brand, region,
 * model and owner copied, and marks the lead Converted. The lead's marketing consent is recorded for the
 * lead's brand only. Activities move to the deal once the Activities module exists (`onLeadConverted`).
 */
export async function convertLead(ctx: AccessContext, id: string, input: ConvertInput) {
  const db = scopedDb(ctx);
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) throw new NotFoundError();
  assertCan(ctx, "leads", "edit", lead);
  assertCan(ctx, "deals", "create", lead);
  if (lead.status === "CONVERTED") throw new BadRequestError("Lead is already converted");
  if (!input.deal.name?.trim()) throw new BadRequestError("Deal name is required");

  const fullName = leadName(lead);
  const sameContact = [...(lead.mobile ? [{ mobile: lead.mobile }] : []), ...(lead.email ? [{ email: lead.email }] : [])];

  // Existing customer with the same mobile / email → link instead of creating a duplicate.
  let contactId: string | null = null;
  let accountId: string | null = null;
  if (input.contact.mode === "existing") {
    const c = await db.contact.findFirst({ where: { id: input.contact.contactId, deletedAt: null }, select: { id: true, accountId: true } });
    if (!c) throw new NotFoundError();
    contactId = c.id;
    accountId = c.accountId;
  } else if (sameContact.length && !(input.account.mode === "new" && input.account.forceNew)) {
    const match = await db.contact.findFirst({ where: { deletedAt: null, OR: sameContact }, select: { id: true, accountId: true }, orderBy: { createdAt: "asc" } });
    if (match) {
      contactId = match.id;
      accountId = match.accountId;
    }
  }

  if (input.account.mode === "existing") {
    const acc = await db.account.findFirst({ where: { id: input.account.accountId, deletedAt: null }, select: { id: true } });
    if (!acc) throw new NotFoundError();
    accountId = acc.id;
  } else if (!accountId) {
    const sameAccount = [...(lead.mobile ? [{ phone: lead.mobile }] : []), ...(lead.email ? [{ email: lead.email }] : [])];
    const match =
      sameAccount.length && !input.account.forceNew
        ? await db.account.findFirst({ where: { deletedAt: null, OR: sameAccount }, select: { id: true }, orderBy: { createdAt: "asc" } })
        : null;
    if (match) accountId = match.id;
    else {
      const acc = await db.account.create({
        data: {
          name: input.account.type === "INDIVIDUAL" ? fullName : input.account.name?.trim() || fullName,
          type: input.account.type,
          city: lead.city,
          phone: lead.mobile,
          email: lead.email,
          ownerId: lead.ownerId,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      await audit({ ctx, action: "CREATE", entity: "Account", entityId: acc.id, after: acc });
      accountId = acc.id;
    }
  }

  if (!contactId) {
    const c = await db.contact.create({
      data: {
        accountId,
        firstName: lead.firstName,
        // a company enquiry without a person becomes a contact named after the company
        lastName: lead.lastName || lead.company || "Contact",
        mobile: lead.mobile,
        email: lead.email,
        city: lead.city,
        ownerId: lead.ownerId,
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    });
    await audit({ ctx, action: "CREATE", entity: "Contact", entityId: c.id, after: c });
    contactId = c.id;
  } else {
    const c = await db.contact.findUniqueOrThrow({ where: { id: contactId }, select: { accountId: true } });
    if (!c.accountId) await db.contact.update({ where: { id: contactId }, data: { accountId } });
  }
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { primaryContactId: true } });
  if (!account.primaryContactId) await db.account.update({ where: { id: accountId }, data: { primaryContactId: contactId } });

  // Consent is per brand: the lead's consent applies to the lead's brand only.
  if (lead.consentMarketing) {
    await db.contactBrandConsent.upsert({
      where: { contactId_brandId: { contactId, brandId: lead.brandId } },
      update: { consent: true, at: lead.consentAt ?? new Date() },
      create: { contactId, brandId: lead.brandId, consent: true, at: lead.consentAt ?? new Date() },
    });
  }

  const deal = await db.deal.create({
    data: {
      name: input.deal.name.trim(),
      amount: input.deal.amount ?? (lead.budget ? Number(lead.budget.toString()) : null),
      closeDate: input.deal.closeDate ? new Date(input.deal.closeDate) : null,
      customerName: fullName,
      brandId: lead.brandId,
      regionId: lead.regionId,
      ownerId: lead.ownerId,
      modelId: lead.modelOfInterestId,
      accountId,
      contactId,
      // campaign attribution (ROI) follows the lead
      campaignId: lead.campaignId,
    } satisfies Prisma.DealUncheckedCreateInput,
    select: { id: true },
  });

  await db.lead.update({
    where: { id },
    data: { status: "CONVERTED", convertedDealId: deal.id, convertedContactId: contactId, convertedAt: new Date() },
  });
  await onLeadConverted(ctx, id, deal.id);
  return { dealId: deal.id, accountId, contactId };
}

/** The lead's activities (tasks, calls, test drives) move to the new deal. */
async function onLeadConverted(ctx: AccessContext, leadId: string, dealId: string): Promise<void> {
  await moveLeadActivitiesToDeal(ctx, leadId, dealId);
}

export function canExportLeads(ctx: AccessContext) {
  return can(ctx, "leads", "export");
}

export { leadWhere };
