/**
 * Approval engine (prompt 08, part A). Lives in the db layer because approvals deliberately cross what a single
 * user may write: an approver of ANOTHER brand decides a brand change, and applying one moves a record between
 * brands. Every entry point therefore authorises the caller first (requester can see the record / approver owns
 * a task) and then works with the system client inside one transaction.
 *
 *   startApproval → tasks for the first step (steps with the same order run in parallel; steps sharing a slot
 *                   are alternatives – any one approver decides) → decideApproval … → effects applied atomically.
 */
import "server-only";
import type { ApprovalStatus, ApprovalStep, Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { loadAccessContext } from "@/server/access/context";
import { resolveTerritory } from "@/server/access/territory";
import type { AccessContext } from "@/server/access/types";
import { hasTerritoryAccess, isVisible } from "@/server/access/visibility";
import { evaluate, type Criteria, type Facts } from "@/server/automation/criteria";
import { BadRequestError } from "@/server/errors";
import { audit } from "./audit";
import { unsafeDb } from "./unsafe";

type Tx = Prisma.TransactionClient;
/* eslint-disable @typescript-eslint/no-explicit-any -- generic over Lead / Deal delegates */

export const APPROVAL_ENTITIES = ["Lead", "Deal", "Quote"] as const;
const RSM_ROLE = "Regional Sales Manager";

export interface StartApproval {
  processKey: string;
  entity: string;
  entityId: string;
  brandId: string;
  regionId: string;
  title: string;
  summary?: string | null;
  /** facts the step conditions are evaluated on */
  facts?: Facts;
  /** what is applied on approval */
  payload?: Record<string, unknown>;
}

export interface ApprovalOutcome {
  requestId: string | null;
  status: ApprovalStatus;
  entity: string;
  entityId: string;
  kind: string;
  title: string;
  requesterId: string;
  /** approvers that now have a pending task (to be notified) */
  pendingApproverIds: string[];
}

interface Comment {
  at: string;
  userId: string | null;
  userName: string;
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "RECALLED" | "AUTO_APPROVED";
  note?: string | null;
}

const slotOf = (s: Pick<ApprovalStep, "id" | "slot">) => s.slot ?? s.id;

async function brandManagers(tx: Tx, brandId: string): Promise<string[]> {
  const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { brandManager: { select: { id: true, active: true } } } });
  if (brand?.brandManager?.active) return [brand.brandManager.id];
  // Fallback: managers of the brand-level territory.
  const members = await tx.territoryMember.findMany({ where: { isManager: true, territory: { brandId, regionId: null }, user: { active: true } }, select: { userId: true } });
  return members.map((m) => m.userId);
}

async function approversFor(tx: Tx, step: ApprovalStep, r: { brandId: string; regionId: string; payload: Record<string, unknown> }): Promise<string[]> {
  switch (step.approverType) {
    case "BRAND_MANAGER_OF_RECORD":
      return brandManagers(tx, r.brandId);
    case "BRAND_MANAGER_OF_NEW_BRAND":
      return typeof r.payload.newBrandId === "string" ? brandManagers(tx, r.payload.newBrandId) : [];
    case "BRAND_ADMIN_OF_RECORD": {
      // the delegated Brand Admins of the brand; a brand without one is decided by the administrators
      const admins = await tx.brandAdmin.findMany({ where: { brandId: r.brandId, user: { active: true } }, select: { userId: true } });
      if (admins.length) return admins.map((a) => a.userId);
      const users = await tx.user.findMany({ where: { active: true, profile: { permissions: { path: ["admin", "edit"], equals: true } } }, select: { id: true }, orderBy: { createdAt: "asc" } });
      return users.map((u) => u.id);
    }
    case "ROLE": {
      const users = await tx.user.findMany({ where: { active: true, role: { name: step.roleName ?? "" } }, select: { id: true }, orderBy: { createdAt: "asc" } });
      return users.map((u) => u.id);
    }
    case "USER": {
      const u = step.userId ? await tx.user.findFirst({ where: { id: step.userId, active: true }, select: { id: true } }) : null;
      return u ? [u.id] : [];
    }
    case "RSM": {
      // Regional managers of the record's brand in its current (or requested) region.
      const regions = [r.regionId, ...(typeof r.payload.newRegionId === "string" ? [r.payload.newRegionId] : [])];
      const users = await tx.user.findMany({
        where: { active: true, role: { name: RSM_ROLE }, memberships: { some: { territory: { brandId: r.brandId, regionId: { in: regions } } } } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
  }
}

function addComment(comments: unknown, c: Comment): Prisma.InputJsonValue {
  return [...(Array.isArray(comments) ? comments : []), c] as unknown as Prisma.InputJsonValue;
}

/**
 * Creates the tasks of step `order`. Slots whose approver is the requester are approved on the spot. Returns the
 * approvers with a pending task; an empty list means the whole step is already satisfied.
 */
async function activateStep(tx: Tx, requestId: string, order: number): Promise<string[]> {
  const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { process: { include: { steps: true } }, owner: { select: { name: true } } } });
  const payload = (req.payload ?? {}) as Record<string, unknown>;
  const stepIds = Array.isArray(payload._steps) ? (payload._steps as string[]) : null;
  const steps = (req.process?.steps ?? []).filter((s) => s.order === order && (!stepIds || stepIds.includes(s.id)));
  const bySlot = new Map<string, { approvers: Set<string>; autoHours: number | null }>();
  for (const s of steps) {
    const slot = bySlot.get(slotOf(s)) ?? { approvers: new Set<string>(), autoHours: null };
    for (const a of await approversFor(tx, s, { brandId: req.brandId, regionId: req.regionId, payload })) slot.approvers.add(a);
    if (s.autoApproveAfterHours) slot.autoHours = Math.min(slot.autoHours ?? Infinity, s.autoApproveAfterHours);
    bySlot.set(slotOf(s), slot);
  }
  const pending: string[] = [];
  const now = new Date();
  for (const [slot, { approvers, autoHours }] of bySlot) {
    if (approvers.size === 0) throw new BadRequestError("No approver is configured for this request (set a Brand Manager for the brand)");
    const self = approvers.has(req.ownerId);
    for (const approverId of approvers) {
      const mine = approverId === req.ownerId;
      await tx.approvalTask.create({
        data: {
          requestId,
          stepOrder: order,
          slot,
          approverId,
          status: self ? (mine ? "APPROVED" : "CANCELLED") : "PENDING",
          note: mine ? "Submitted by the approver" : null,
          decidedAt: self ? now : null,
          autoApproveAt: !self && autoHours ? new Date(now.getTime() + autoHours * 3_600_000) : null,
          kind: req.kind,
          title: req.title,
          summary: req.reason,
          entity: req.entity,
          entityId: req.entityId,
          brandId: req.brandId,
          regionId: req.regionId,
          requesterId: req.ownerId,
          requesterName: req.owner.name,
        },
      });
      if (!self) pending.push(approverId);
    }
  }
  await tx.approvalRequest.update({ where: { id: requestId }, data: { currentStep: order, approverId: pending[0] ?? null } });
  return [...new Set(pending)];
}

/** Moves on from a satisfied step: next step with tasks, or final approval + effects. */
async function advance(tx: Tx, requestId: string, fromOrder: number, actor: { id: string | null; name: string }): Promise<{ status: ApprovalStatus; pending: string[] }> {
  const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { process: { include: { steps: true } } } });
  const payload = (req.payload ?? {}) as Record<string, unknown>;
  const stepIds = Array.isArray(payload._steps) ? (payload._steps as string[]) : null;
  const orders = [...new Set((req.process?.steps ?? []).filter((s) => !stepIds || stepIds.includes(s.id)).map((s) => s.order))].sort((a, b) => a - b);
  for (const order of orders.filter((o) => o > fromOrder)) {
    const pending = await activateStep(tx, requestId, order);
    if (pending.length) return { status: "PENDING", pending };
  }
  await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "APPROVED", decidedAt: new Date(), approverId: actor.id ?? req.approverId } });
  await applyEffects(tx, requestId, true, actor);
  return { status: "APPROVED", pending: [] };
}

// ───────────────────────────── effects ─────────────────────────────

async function assertOwnerFits(ownerId: string, brandId: string, regionId: string) {
  const owner = await loadAccessContext(ownerId);
  if (!owner) throw new BadRequestError("The owner must be an active user");
  if (!hasTerritoryAccess(owner, brandId, regionId)) throw new BadRequestError(`${owner.user.name} does not work in the target brand/region – choose a new owner`);
}

/** Checks shared by the request form and the final application of a brand change / owner transfer. */
export async function validateMove(
  db: Tx,
  entity: string,
  record: { id: string; brandId: string; regionId: string; ownerId: string },
  target: { brandId: string; regionId: string; ownerId: string },
) {
  const brand = await db.brand.findUnique({ where: { id: target.brandId }, select: { code: true, status: true } });
  if (!brand) throw new BadRequestError("Unknown brand");
  if (brand.status === "INACTIVE") throw new BadRequestError(`Brand ${brand.code} is inactive`);
  await resolveTerritory(db, target.brandId, target.regionId).catch(() => {
    throw new BadRequestError(`${brand.code} has no territory for this region`);
  });
  await assertOwnerFits(target.ownerId, target.brandId, target.regionId);
  if (entity === "Deal" && target.brandId !== record.brandId) {
    const [orders, invoices] = await Promise.all([
      db.salesOrder.count({ where: { dealId: record.id, deletedAt: null, status: { not: "CANCELLED" } } }),
      db.invoice.count({ where: { dealId: record.id, deletedAt: null, status: { not: "VOID" } } }),
    ]);
    if (orders + invoices > 0) throw new BadRequestError("A deal with sales orders or invoices cannot change brand – cancel them first");
  }
}

/** Pre-check of a brand change / owner transfer when the request is submitted. */
export const checkMove = (entity: string, record: Parameters<typeof validateMove>[2], target: Parameters<typeof validateMove>[3]) =>
  validateMove(unsafeDb as unknown as Tx, entity, record, target);

/**
 * Moves a lead or deal (and its children: quotes, activities, notes, attachments) to another brand and / or
 * region in ONE transaction. Territory is recalculated; the deal pipeline follows the brand (DB trigger keeps
 * the stage by key); brand-specific links (model, reserved vehicle, quote products) are cleared on a brand change.
 */
async function moveRecord(tx: Tx, req: { id: string; entity: string; entityId: string; kind: string }, payload: Record<string, unknown>, actor: { id: string | null; name: string }) {
  const delegate = (tx as any)[req.entity === "Lead" ? "lead" : "deal"];
  const before = await delegate.findUnique({ where: { id: req.entityId } });
  if (!before || before.deletedAt) throw new BadRequestError("The record no longer exists");
  const target = {
    brandId: typeof payload.newBrandId === "string" ? payload.newBrandId : (before.brandId as string),
    regionId: typeof payload.newRegionId === "string" ? payload.newRegionId : (before.regionId as string),
    ownerId: typeof payload.newOwnerId === "string" && payload.newOwnerId ? payload.newOwnerId : (before.ownerId as string),
  };
  await validateMove(tx, req.entity, before, target);
  const territoryId = await resolveTerritory(tx, target.brandId, target.regionId);
  const brandChanged = target.brandId !== before.brandId;
  const base = { brandId: target.brandId, regionId: target.regionId, territoryId };

  if (req.entity === "Lead") {
    await tx.lead.update({ where: { id: before.id }, data: { ...base, ownerId: target.ownerId, updatedById: actor.id, ...(brandChanged ? { modelOfInterestId: null } : {}) } });
  } else {
    if (brandChanged) {
      // Brand-specific links cannot follow: the reserved vehicle goes back to the old brand's stock.
      const reserved = await tx.vehicleUnit.findMany({ where: { dealId: before.id, status: "RESERVED" }, select: { id: true, brandId: true } });
      await tx.vehicleUnit.updateMany({ where: { id: { in: reserved.map((u) => u.id) } }, data: { status: "AVAILABLE", dealId: null, reservedById: null, reservedUntil: null } });
      if (reserved.length) await tx.vehicleStatusHistory.createMany({ data: reserved.map((u) => ({ brandId: u.brandId, unitId: u.id, from: "RESERVED" as const, to: "AVAILABLE" as const, note: "Deal moved to another brand", userId: actor.id })) });
    }
    await tx.deal.update({
      where: { id: before.id },
      data: { ...base, ownerId: target.ownerId, updatedById: actor.id, ...(brandChanged ? { modelId: null, vinChassisNo: null, engineNo: null } : {}) },
    });
    const quotes = await tx.quote.findMany({ where: { dealId: before.id }, select: { id: true, status: true } });
    if (brandChanged && quotes.length) {
      const ids = quotes.map((q) => q.id);
      // Products and price books belong to the old brand; quotes go back to draft to be re-priced.
      await tx.documentLine.updateMany({ where: { quoteId: { in: ids } }, data: { productId: null } });
      const stale = await tx.approvalRequest.findMany({ where: { entity: "Quote", entityId: { in: ids }, status: "PENDING" }, select: { id: true } });
      await tx.approvalTask.updateMany({ where: { requestId: { in: stale.map((s) => s.id) }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
      await tx.approvalRequest.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: "CANCELLED", decidedAt: new Date() } });
      await tx.quote.updateMany({ where: { id: { in: ids }, status: { in: ["PENDING_APPROVAL", "APPROVED", "SENT"] } }, data: { status: "DRAFT" } });
      await tx.quote.updateMany({ where: { id: { in: ids } }, data: { ...base, priceBookId: null } });
    } else {
      await tx.quote.updateMany({ where: { dealId: before.id }, data: base });
    }
    await tx.salesOrder.updateMany({ where: { dealId: before.id }, data: base });
    await tx.invoice.updateMany({ where: { dealId: before.id }, data: base });
    const children = [{ entity: "Quote", ids: quotes.map((q) => q.id) }];
    for (const c of children) {
      if (!c.ids.length) continue;
      await tx.note.updateMany({ where: { entity: c.entity, entityId: { in: c.ids } }, data: base });
      await tx.attachment.updateMany({ where: { entity: c.entity, entityId: { in: c.ids } }, data: base });
    }
  }
  const activities = await tx.activity.findMany({ where: { parentType: req.entity, parentId: before.id }, select: { id: true } });
  await tx.activity.updateMany({ where: { id: { in: activities.map((a) => a.id) } }, data: base });
  if (brandChanged) await tx.testDrive.updateMany({ where: { activityId: { in: activities.map((a) => a.id) } }, data: { brandId: target.brandId, productId: null } });
  await tx.note.updateMany({ where: { entity: req.entity, entityId: before.id }, data: base });
  await tx.attachment.updateMany({ where: { entity: req.entity, entityId: before.id }, data: base });

  const after = await delegate.findUnique({ where: { id: before.id } });
  return { before, after };
}

type AuditTodo = { entity: string; entityId: string; brandId: string; before: unknown; after: unknown };

async function applyEffects(tx: Tx, requestId: string, approved: boolean, actor: { id: string | null; name: string }): Promise<void> {
  const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (req.kind === "DISCOUNT" && req.entity === "Quote") {
    // Rejected / recalled discount requests send the quote back to draft so it can be revised.
    await tx.quote.updateMany({ where: { id: req.entityId, status: "PENDING_APPROVAL" }, data: { status: approved ? "APPROVED" : "DRAFT" } });
    return;
  }
  if (req.kind === "DOCUMENT_TEMPLATE" && req.entity === "DocumentTemplate") {
    // Approved: the working copy becomes the published version. Rejected / recalled: back to what it was before.
    const t = await tx.documentTemplate.findUnique({ where: { id: req.entityId } });
    if (!t || t.status !== "PENDING_APPROVAL") return;
    if (!approved) {
      await tx.documentTemplate.update({ where: { id: t.id }, data: { status: t.published ? "PUBLISHED" : "DRAFT" } });
      return;
    }
    const version = t.version + 1;
    await tx.documentTemplate.update({ where: { id: t.id }, data: { status: "PUBLISHED", published: t.content as Prisma.InputJsonValue, dirty: false, version, approvedById: actor.id, publishedAt: new Date() } });
    await tx.documentTemplateVersion.create({ data: { templateId: t.id, version, snapshot: { name: t.name, paper: t.paper, orientation: t.orientation, margins: t.margins, content: t.content, cssOverrides: t.cssOverrides } as Prisma.InputJsonValue, changedById: t.createdById, note: `Approved by ${actor.name}` } });
    pendingAudits.get(tx)?.push({ entity: "DocumentTemplate", entityId: t.id, brandId: req.brandId, before: { status: "PENDING_APPROVAL", version: t.version }, after: { status: "PUBLISHED", version, approvedBy: actor.name } });
    return;
  }
  if (!approved) return;
  if (req.kind === "BRAND_CHANGE" || req.kind === "OWNER_TRANSFER") {
    const { before, after } = await moveRecord(tx, req, (req.payload ?? {}) as Record<string, unknown>, actor);
    const pick = (r: any) => ({ brandId: r.brandId, regionId: r.regionId, territoryId: r.territoryId, ownerId: r.ownerId, ...(req.entity === "Deal" ? { pipelineId: r.pipelineId, stageId: r.stageId, modelId: r.modelId } : {}) });
    pendingAudits.get(tx)?.push({
      entity: req.entity,
      entityId: req.entityId,
      brandId: after.brandId,
      before: pick(before),
      after: { ...pick(after), [req.kind === "BRAND_CHANGE" ? "brandChange" : "ownerTransfer"]: { approvalRequestId: req.id, approvedBy: actor.name } },
    });
  }
}
/** Audit entries are written after the transaction commits (audit() uses its own connection). */
const pendingAudits = new WeakMap<object, AuditTodo[]>();

async function inTransaction<T>(ctx: Pick<AccessContext, "userId" | "ip"> | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const audits: AuditTodo[] = [];
  const result = await unsafeDb.$transaction(async (raw) => {
    const tx = raw as unknown as Tx;
    pendingAudits.set(tx, audits);
    return fn(tx);
  });
  for (const a of audits) await audit({ ctx, action: "UPDATE", ...a });
  return result;
}

// ───────────────────────────── entry points ─────────────────────────────

/**
 * Starts an approval for a record the caller can see. Returns status APPROVED when every applicable step is
 * satisfied by the requester (e.g. a Brand Manager approving their own discount).
 */
export async function startApproval(ctx: AccessContext, input: StartApproval): Promise<ApprovalOutcome> {
  if (!isVisible(ctx, { brandId: input.brandId, regionId: input.regionId })) throw new NotFoundError();
  const process = await unsafeDb.approvalProcess.findUnique({ where: { key: input.processKey }, include: { steps: true } });
  if (!process) throw new BadRequestError(`Approval process ${input.processKey} is not configured`);
  const facts = input.facts ?? {};
  const steps = process.steps.filter((s) => !s.condition || evaluate(s.condition as Criteria, facts));
  const brandMatches = !process.brandId || process.brandId === input.brandId;
  const base = { entity: input.entity, entityId: input.entityId, kind: process.key, title: input.title, requesterId: ctx.userId };
  if (!process.active || !brandMatches || steps.length === 0 || !evaluate(process.criteria as Criteria, facts)) {
    // Nothing to approve under the current configuration: effects apply directly.
    return inTransaction(ctx, async (tx) => {
      const req = await tx.approvalRequest.create({ data: await requestData(tx, ctx, input, process.id, process.key, [], "APPROVED") });
      await applyEffects(tx, req.id, true, { id: ctx.userId, name: ctx.user.name });
      return { ...base, requestId: req.id, status: "APPROVED" as const, pendingApproverIds: [] };
    });
  }
  try {
    return await inTransaction(ctx, async (tx) => {
      const req = await tx.approvalRequest.create({ data: await requestData(tx, ctx, input, process.id, process.key, steps.map((s) => s.id), "PENDING") });
      const { status, pending } = await advance(tx, req.id, 0, { id: ctx.userId, name: ctx.user.name });
      return { ...base, requestId: req.id, status, pendingApproverIds: pending };
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") throw new BadRequestError("An approval is already pending for this record");
    throw err;
  }
}

async function requestData(tx: Tx, ctx: AccessContext, input: StartApproval, processId: string, kind: string, stepIds: string[], status: ApprovalStatus) {
  const orders = stepIds.length;
  return {
    kind,
    processId,
    entity: input.entity,
    entityId: input.entityId,
    status,
    level: Math.max(1, orders),
    title: input.title.slice(0, 200),
    reason: input.summary?.slice(0, 1000) ?? null,
    payload: { ...(input.payload ?? {}), _steps: stepIds, _facts: JSON.parse(JSON.stringify(input.facts ?? {})) } as Prisma.InputJsonValue,
    comments: addComment([], { at: new Date().toISOString(), userId: ctx.userId, userName: ctx.user.name, action: "SUBMITTED", note: input.summary ?? null }),
    decidedAt: status === "PENDING" ? null : new Date(),
    brandId: input.brandId,
    regionId: input.regionId,
    territoryId: await resolveTerritory(tx, input.brandId, input.regionId).catch(() => null),
    ownerId: ctx.userId,
    createdById: ctx.userId,
    updatedById: ctx.userId,
  } satisfies Prisma.ApprovalRequestUncheckedCreateInput;
}

/** May the user decide in place of the assigned approvers? Administrators, and Management with approve rights. */
function mayOverride(ctx: AccessContext): boolean {
  return ctx.isAdmin || (ctx.scope === "ALL" && Object.values(ctx.profile.permissions).some((p) => p?.approve));
}

/**
 * Approve or reject. The caller must hold a pending task of the current step (or be allowed to override).
 * Hidden requests are a 404; visible ones without a task a 403.
 */
export async function decideApproval(ctx: AccessContext, requestId: string, approve: boolean, note?: string | null): Promise<ApprovalOutcome> {
  return inTransaction(ctx, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findUnique({ where: { id: requestId }, include: { tasks: true } });
    if (!req || req.deletedAt) throw new NotFoundError();
    const hasTask = req.tasks.some((t) => t.approverId === ctx.userId);
    if (!hasTask && !isVisible(ctx, req)) throw new NotFoundError();
    if (req.status !== "PENDING") throw new BadRequestError("This request has already been decided");
    const current = req.tasks.filter((t) => t.stepOrder === req.currentStep && t.status === "PENDING");
    const mine = current.filter((t) => t.approverId === ctx.userId);
    const override = mine.length === 0 && mayOverride(ctx);
    if (mine.length === 0 && !override) throw new ForbiddenError("Only the assigned approver can decide this request");
    const now = new Date();
    const text = note?.trim().slice(0, 1000) || null;
    const actor = { id: ctx.userId, name: ctx.user.name };
    const comments = addComment(req.comments, { at: now.toISOString(), userId: ctx.userId, userName: ctx.user.name, action: approve ? "APPROVED" : "REJECTED", note: text });
    const base = { requestId, entity: req.entity, entityId: req.entityId, kind: req.kind, title: req.title, requesterId: req.ownerId };

    if (!approve) {
      await tx.approvalTask.updateMany({ where: { id: { in: mine.map((t) => t.id) } }, data: { status: "REJECTED", note: text, decidedAt: now } });
      await tx.approvalTask.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now } });
      await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "REJECTED", decidedAt: now, decisionNote: text, approverId: ctx.userId, comments, updatedById: ctx.userId } });
      await applyEffects(tx, requestId, false, actor);
      return { ...base, status: "REJECTED" as const, pendingApproverIds: [] };
    }

    // Approve my slots (or every open slot when overriding); alternatives in those slots are closed.
    const slots = new Set((override ? current : mine).map((t) => t.slot));
    await tx.approvalTask.updateMany({ where: { id: { in: (override ? [] : mine).map((t) => t.id) } }, data: { status: "APPROVED", note: text, decidedAt: now } });
    await tx.approvalTask.updateMany({ where: { requestId, stepOrder: req.currentStep, status: "PENDING", slot: { in: [...slots] } }, data: { status: "CANCELLED", decidedAt: now, note: override ? `Decided by ${ctx.user.name}` : null } });
    await tx.approvalRequest.update({ where: { id: requestId }, data: { comments, decisionNote: text, updatedById: ctx.userId } });
    const open = await tx.approvalTask.findMany({ where: { requestId, stepOrder: req.currentStep, status: "PENDING" }, select: { approverId: true } });
    if (open.length) {
      await tx.approvalRequest.update({ where: { id: requestId }, data: { approverId: open[0]!.approverId } });
      return { ...base, status: "PENDING" as const, pendingApproverIds: [] };
    }
    const { status, pending } = await advance(tx, requestId, req.currentStep, actor);
    return { ...base, status, pendingApproverIds: pending };
  });
}

/** The requester (or an administrator) withdraws a pending request. */
export async function recallApproval(ctx: AccessContext, requestId: string): Promise<ApprovalOutcome> {
  return inTransaction(ctx, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!req || req.deletedAt || !isVisible(ctx, req)) throw new NotFoundError();
    if (req.ownerId !== ctx.userId && !ctx.isAdmin) throw new ForbiddenError("Only the requester can recall this request");
    if (req.status !== "PENDING") throw new BadRequestError("This request has already been decided");
    const now = new Date();
    await tx.approvalTask.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now } });
    await tx.approvalRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", decidedAt: now, updatedById: ctx.userId, comments: addComment(req.comments, { at: now.toISOString(), userId: ctx.userId, userName: ctx.user.name, action: "RECALLED" }) },
    });
    await applyEffects(tx, requestId, false, { id: ctx.userId, name: ctx.user.name });
    return { requestId, status: "CANCELLED" as const, entity: req.entity, entityId: req.entityId, kind: req.kind, title: req.title, requesterId: req.ownerId, pendingApproverIds: [] };
  });
}

/** Cancels the pending requests of a record (e.g. a quote sent back to draft). System-side, caller authorises. */
export async function cancelPendingApprovals(entity: string, entityId: string): Promise<number> {
  const open = await unsafeDb.approvalRequest.findMany({ where: { entity, entityId, status: "PENDING" }, select: { id: true } });
  if (open.length === 0) return 0;
  const now = new Date();
  await unsafeDb.$transaction([
    unsafeDb.approvalTask.updateMany({ where: { requestId: { in: open.map((o) => o.id) }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now } }),
    unsafeDb.approvalRequest.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "CANCELLED", decidedAt: now } }),
  ]);
  return open.length;
}

/** Scheduler: approves tasks whose auto-approve time has passed. Idempotent. */
export async function autoApproveDue(now = new Date()): Promise<ApprovalOutcome[]> {
  const due = await unsafeDb.approvalTask.findMany({ where: { status: "PENDING", autoApproveAt: { lte: now } }, select: { id: true, requestId: true, slot: true, stepOrder: true }, take: 200 });
  const out: ApprovalOutcome[] = [];
  for (const t of due) {
    const res = await inTransaction(null, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${t.requestId} FOR UPDATE`;
      const req = await tx.approvalRequest.findUnique({ where: { id: t.requestId } });
      const task = await tx.approvalTask.findUnique({ where: { id: t.id } });
      if (!req || req.status !== "PENDING" || task?.status !== "PENDING" || req.currentStep !== t.stepOrder) return null;
      await tx.approvalTask.update({ where: { id: t.id }, data: { status: "APPROVED", decidedAt: now, note: "Auto-approved (no decision in time)" } });
      await tx.approvalTask.updateMany({ where: { requestId: t.requestId, stepOrder: t.stepOrder, slot: t.slot, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now } });
      await tx.approvalRequest.update({ where: { id: t.requestId }, data: { comments: addComment(req.comments, { at: now.toISOString(), userId: null, userName: "System", action: "AUTO_APPROVED" }) } });
      const base = { requestId: req.id, entity: req.entity, entityId: req.entityId, kind: req.kind, title: req.title, requesterId: req.ownerId };
      const open = await tx.approvalTask.count({ where: { requestId: t.requestId, stepOrder: t.stepOrder, status: "PENDING" } });
      if (open) return { ...base, status: "PENDING" as const, pendingApproverIds: [] };
      const { status, pending } = await advance(tx, req.id, t.stepOrder, { id: null, name: "System" });
      return { ...base, status, pendingApproverIds: pending };
    });
    if (res) out.push(res);
  }
  return out;
}

// ───────────────────────────── admin: process configuration ─────────────────────────────

export function listApprovalProcesses() {
  return unsafeDb.approvalProcess.findMany({ include: { steps: { orderBy: [{ order: "asc" }, { id: "asc" }] }, brand: { select: { code: true } } }, orderBy: { name: "asc" } });
}

/** Administrator: switch a process on / off and set the auto-approve time of its steps. */
export async function updateApprovalProcess(ctx: AccessContext, id: string, data: { active?: boolean; autoApproveAfterHours?: Record<string, number | null> }) {
  if (!ctx.isAdmin) throw new NotFoundError();
  const before = await unsafeDb.approvalProcess.findUnique({ where: { id }, include: { steps: true } });
  if (!before) throw new NotFoundError();
  await unsafeDb.$transaction([
    ...(data.active === undefined ? [] : [unsafeDb.approvalProcess.update({ where: { id }, data: { active: data.active } })]),
    ...Object.entries(data.autoApproveAfterHours ?? {})
      .filter(([stepId]) => before.steps.some((s) => s.id === stepId))
      .map(([stepId, hours]) => unsafeDb.approvalStep.update({ where: { id: stepId }, data: { autoApproveAfterHours: hours && hours > 0 ? Math.min(Math.round(hours), 24 * 60) : null } })),
  ]);
  await audit({ ctx, action: "UPDATE", entity: "ApprovalProcess", entityId: id, before: { active: before.active }, after: data });
}
