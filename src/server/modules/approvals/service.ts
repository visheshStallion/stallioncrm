/**
 * Approvals (prompt 08, part A): thin user-facing layer over the approval engine – requests for a brand change
 * or a cross-region owner transfer, decisions, recall, inbox queries and notifications.
 */
import "server-only";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import * as engine from "@/server/db/approval-engine";
import type { ApprovalOutcome, StartApproval } from "@/server/db/approval-engine";
import { BadRequestError } from "@/server/errors";
import { notify } from "@/server/modules/notifications/service";

export const KIND_LABELS: Record<string, string> = { DISCOUNT: "Discount approval", BRAND_CHANGE: "Brand change", OWNER_TRANSFER: "Owner transfer", DOCUMENT_TEMPLATE: "Document template", RECORD_TEMPLATE: "Record template" };
export const STATUS_LABELS: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Recalled" };
const MOVABLE: Record<string, { module: ModuleKey; path: string }> = { Lead: { module: "leads", path: "/leads" }, Deal: { module: "deals", path: "/deals" } };
const PATHS: Record<string, string> = { Lead: "/leads", Deal: "/deals", Quote: "/quotes", DocumentTemplate: "/templates/documents", RecordTemplate: "/templates/records" };
export const recordHref = (entity: string, id: string) => (PATHS[entity] ? `${PATHS[entity]}/${id}` : null);

/** In-app notifications for an engine outcome: new approvers get a task, the requester learns the decision. */
async function announce(ctx: AccessContext, o: ApprovalOutcome) {
  const label = KIND_LABELS[o.kind] ?? "Approval";
  await notify(ctx, o.pendingApproverIds.filter((u) => u !== ctx.userId), { kind: "APPROVAL", title: `${label} needs your decision`, body: o.title, href: "/approvals" });
  if (o.status !== "PENDING" && o.requesterId !== ctx.userId) {
    await notify(ctx, [o.requesterId], { kind: "APPROVAL", title: `${label} ${STATUS_LABELS[o.status]!.toLowerCase()}`, body: o.title, href: recordHref(o.entity, o.entityId) ?? "/approvals?tab=submitted" });
  }
  if (o.entity === "Quote" && o.status === "APPROVED") await (await import("@/server/integrations/events")).dispatchEvent("quote.approved", o.entityId);
  return o;
}

/** Used by other modules (quotes) to start an approval and notify the approvers. */
export async function submitForApproval(ctx: AccessContext, input: StartApproval) {
  return announce(ctx, await engine.startApproval(ctx, input));
}

export async function decide(ctx: AccessContext, requestId: string, approve: boolean, note?: string | null) {
  return announce(ctx, await engine.decideApproval(ctx, requestId, approve, note));
}

export async function recall(ctx: AccessContext, requestId: string) {
  return engine.recallApproval(ctx, requestId);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- generic over Lead / Deal delegates */
async function loadMovable(ctx: AccessContext, entity: string, id: string) {
  const def = MOVABLE[entity];
  if (!def) throw new BadRequestError("Only leads and deals can be moved");
  const db = scopedDb(ctx) as any;
  const record = await db[entity === "Lead" ? "lead" : "deal"].findUnique({
    where: { id },
    select: { id: true, brandId: true, regionId: true, ownerId: true, ...(entity === "Lead" ? { firstName: true, lastName: true, status: true } : { name: true }) },
  });
  if (!record) throw new NotFoundError();
  assertCan(ctx, def.module, "edit", record);
  if (entity === "Lead" && record.status === "CONVERTED") throw new BadRequestError("A converted lead cannot be moved");
  const name: string = entity === "Lead" ? [record.firstName, record.lastName].filter(Boolean).join(" ") : record.name;
  return { record: record as { id: string; brandId: string; regionId: string; ownerId: string }, name };
}

/**
 * Brand change (BUSINESS_CONTEXT §10): needs the Brand Managers of the OLD and the NEW brand. On approval the
 * record and its children move to the new brand atomically (territory recalculated, audit before / after).
 */
export async function requestBrandChange(ctx: AccessContext, entity: string, id: string, input: { newBrandId: string; newOwnerId?: string | null; reason?: string | null }) {
  const { record, name } = await loadMovable(ctx, entity, id);
  if (!input.newBrandId || input.newBrandId === record.brandId) throw new BadRequestError("Choose a different brand");
  const db = scopedDb(ctx);
  const [from, to] = await Promise.all([
    db.brand.findUnique({ where: { id: record.brandId }, select: { code: true } }),
    db.brand.findUnique({ where: { id: input.newBrandId }, select: { code: true } }),
  ]);
  if (!to) throw new BadRequestError("Unknown brand");
  const target = { brandId: input.newBrandId, regionId: record.regionId, ownerId: input.newOwnerId || record.ownerId };
  await engine.checkMove(entity, record, target);
  return submitForApproval(ctx, {
    processKey: "BRAND_CHANGE",
    entity,
    entityId: id,
    brandId: record.brandId,
    regionId: record.regionId,
    title: `${entity} "${name}": brand ${from?.code} → ${to.code}`,
    summary: input.reason?.trim() || null,
    payload: { newBrandId: input.newBrandId, newOwnerId: target.ownerId === record.ownerId ? null : target.ownerId, fromBrand: from?.code, toBrand: to.code },
  });
}

/** Owner transfer to another region: approved by the RSM or the Brand Manager. */
export async function requestOwnerTransfer(ctx: AccessContext, entity: string, id: string, input: { newRegionId: string; newOwnerId: string; reason?: string | null }) {
  const { record, name } = await loadMovable(ctx, entity, id);
  if (!input.newRegionId || input.newRegionId === record.regionId) throw new BadRequestError("Choose a different region (use Change owner inside the same region)");
  if (!input.newOwnerId) throw new BadRequestError("Choose the new owner");
  const db = scopedDb(ctx);
  const [from, to, owner] = await Promise.all([
    db.region.findUnique({ where: { id: record.regionId }, select: { name: true } }),
    db.region.findUnique({ where: { id: input.newRegionId }, select: { name: true } }),
    db.user.findUnique({ where: { id: input.newOwnerId }, select: { name: true } }),
  ]);
  if (!to || !owner) throw new BadRequestError("Unknown region or owner");
  await engine.checkMove(entity, record, { brandId: record.brandId, regionId: input.newRegionId, ownerId: input.newOwnerId });
  return submitForApproval(ctx, {
    processKey: "OWNER_TRANSFER",
    entity,
    entityId: id,
    brandId: record.brandId,
    regionId: record.regionId,
    title: `${entity} "${name}": ${from?.name} → ${to.name} (${owner.name})`,
    summary: input.reason?.trim() || null,
    payload: { newRegionId: input.newRegionId, newOwnerId: input.newOwnerId, fromRegion: from?.name, toRegion: to.name },
  });
}

// ───────────────────────────── queries ─────────────────────────────

export interface InboxItem {
  taskId: string;
  requestId: string;
  kind: string;
  title: string;
  summary: string | null;
  entity: string;
  entityId: string;
  /** link to the record – only when the viewer can open it (an approver of another brand cannot) */
  href: string | null;
  brandId: string;
  requesterName: string;
  status: string;
  at: string;
  decidedAt: string | null;
  note: string | null;
}

/** "My Approvals": the caller's own tasks – RLS guarantees an approver never sees other brands' requests. */
export async function myApprovalTasks(ctx: AccessContext, status: "PENDING" | "DECIDED" = "PENDING", take = 100): Promise<InboxItem[]> {
  const rows = await scopedDb(ctx).approvalTask.findMany({
    where: { approverId: ctx.userId, status: status === "PENDING" ? "PENDING" : { in: ["APPROVED", "REJECTED"] } },
    orderBy: { createdAt: "desc" },
    take,
  });
  const visible = (t: { brandId: string; regionId: string }) => ctx.scope === "ALL" || ctx.memberships.some((m) => m.brandId === t.brandId && (m.regionId === null || m.regionId === t.regionId));
  return rows.map((t) => ({
    taskId: t.id,
    requestId: t.requestId,
    kind: t.kind,
    title: t.title,
    summary: t.summary,
    entity: t.entity,
    entityId: t.entityId,
    href: visible(t) ? recordHref(t.entity, t.entityId) : null,
    brandId: t.brandId,
    requesterName: t.requesterName,
    status: t.status,
    at: t.createdAt.toISOString(),
    decidedAt: t.decidedAt?.toISOString() ?? null,
    note: t.note,
  }));
}

export async function pendingApprovalCount(ctx: AccessContext): Promise<number> {
  return scopedDb(ctx).approvalTask.count({ where: { approverId: ctx.userId, status: "PENDING" } });
}

/** Requests the caller submitted. */
export async function mySubmittedApprovals(ctx: AccessContext, take = 100) {
  const rows = await scopedDb(ctx).approvalRequest.findMany({
    where: { ownerId: ctx.userId },
    select: { id: true, kind: true, title: true, reason: true, entity: true, entityId: true, status: true, brandId: true, createdAt: true, decidedAt: true, decisionNote: true, approver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({ ...r, href: recordHref(r.entity, r.entityId), at: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, approverName: r.approver?.name ?? null }));
}

export interface RecordApproval {
  id: string;
  kind: string;
  title: string;
  reason: string | null;
  requestedBy: string;
  requesterId: string;
  at: string;
  /** names of the approvers still to decide */
  waitingFor: string[];
  /** the viewer holds a pending task of the current step */
  canDecide: boolean;
  canRecall: boolean;
  comments: Array<{ at: string; userName: string; action: string; note?: string | null }>;
}

/** Pending approvals of a record (banner on the record page; the record is locked while one exists). */
export async function pendingApprovalsFor(ctx: AccessContext, entity: string, entityId: string): Promise<RecordApproval[]> {
  const db = scopedDb(ctx);
  const requests = await db.approvalRequest.findMany({
    where: { entity, entityId, status: "PENDING" },
    select: { id: true, kind: true, title: true, reason: true, currentStep: true, comments: true, ownerId: true, owner: { select: { name: true } }, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (requests.length === 0) return [];
  const tasks = await db.approvalTask.findMany({ where: { requestId: { in: requests.map((r) => r.id) }, status: "PENDING" }, select: { requestId: true, stepOrder: true, approverId: true, approver: { select: { name: true } } } });
  const override = ctx.isAdmin || (ctx.scope === "ALL" && Object.values(ctx.profile.permissions).some((p) => p?.approve));
  return requests.map((r) => {
    const current = tasks.filter((t) => t.requestId === r.id && t.stepOrder === r.currentStep);
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      reason: r.reason,
      requestedBy: r.owner.name,
      requesterId: r.ownerId,
      at: r.createdAt.toISOString(),
      waitingFor: [...new Set(current.map((t) => t.approver.name))],
      canDecide: override || current.some((t) => t.approverId === ctx.userId),
      canRecall: r.ownerId === ctx.userId || ctx.isAdmin,
      comments: (Array.isArray(r.comments) ? r.comments : []) as RecordApproval["comments"],
    };
  });
}
