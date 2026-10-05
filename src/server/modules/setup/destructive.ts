/**
 * Four-eyes for destructive Setup operations (prompt 19 §1): a Super Admin requests the operation after
 * re-authentication; it runs only when a SECOND Super Admin approves it, again after re-authentication. The request,
 * the decision and the result are audited – the audit entry of the decision names both people.
 */
import "server-only";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import * as store from "@/server/db/setup-store";
import { BadRequestError } from "@/server/errors";
import { z } from "zod";
import { assertSuperAdmin } from "./access";
import { applySetting, massCriteria, reauthenticate } from "./service";
import { SETTINGS, isSettingKey } from "./settings";

export const APPROVAL_HOURS = 72;

interface Actors {
  requesterId: string;
  approver: AccessContext;
}

interface Operation<P> {
  label: string;
  schema: z.ZodType<P>;
  /** One line shown to the second Super Admin. May reject the request (throw) before it is stored. */
  summarise: (payload: P) => Promise<string>;
  execute: (payload: P, actors: Actors) => Promise<unknown>;
}

const op = <P,>(o: Operation<P>) => o as Operation<unknown>;

export const OPERATIONS = {
  "security.policy": op({
    label: "Change an authentication policy",
    schema: z.object({ key: z.string(), value: z.unknown() }),
    summarise: async ({ key, value }) => {
      if (!isSettingKey(key) || !SETTINGS[key].fourEyes) throw new BadRequestError("Unknown policy");
      const parsed = (SETTINGS[key].schema as z.ZodTypeAny).parse(value);
      return `${SETTINGS[key].title}: ${JSON.stringify(parsed)}`;
    },
    execute: async ({ key, value }, { approver }) => {
      if (!isSettingKey(key)) throw new BadRequestError("Unknown policy");
      await applySetting(approver, key, value);
      return { applied: key };
    },
  }),
  "recycle.purge": op({
    label: "Purge the recycle bin",
    schema: z.object({ model: z.string(), ids: z.array(z.string()).max(5000).optional() }),
    summarise: async ({ model, ids }) => {
      if (!store.RECYCLABLE_MODELS.includes(model)) throw new BadRequestError("This module has no recycle bin");
      const available = (await store.deletedCounts()).find((c) => c.model === model)?.count ?? 0;
      const n = ids?.length ?? available;
      if (!n) throw new BadRequestError("There is nothing to purge");
      return `Permanently delete ${n} ${model} record(s) from the recycle bin – they cannot be restored afterwards`;
    },
    execute: async ({ model, ids }) => store.purgeDeleted(model, { ids }),
  }),
  "data.massDelete": op({
    label: "Mass delete",
    schema: z.object({ module: z.string(), brandId: z.string().nullable().optional(), ownerId: z.string().nullable().optional(), createdBefore: z.string().nullable().optional() }),
    summarise: async (payload) => {
      const criteria = massCriteria(payload);
      const count = await store.massCount(criteria);
      if (!count) throw new BadRequestError("No record matches these criteria");
      const parts = [criteria.brandId ? "one brand" : null, criteria.ownerId ? "one owner" : null, criteria.createdBefore ? `created before ${criteria.createdBefore}` : null].filter(Boolean).join(", ");
      return `Move ${count} ${criteria.model} record(s) (${parts}) to the recycle bin`;
    },
    execute: async (payload, { approver }) => ({ deleted: await store.massSoftDelete(massCriteria(payload), approver.userId) }),
  }),
  "data.removeSample": op({
    label: "Remove sample data",
    schema: z.object({}),
    summarise: async () => {
      const counts = await store.businessCounts();
      const total = counts.reduce((s, c) => s + c.count, 0);
      if (!total) throw new BadRequestError("There is no business data to remove");
      return `Delete ALL business data for good (${total} rows in ${counts.length} tables: leads, deals, customers, documents, activities, cases, messages, stock, journals). Configuration, users and the audit log stay`;
    },
    execute: async () => {
      const before = await store.businessCounts();
      await store.truncateBusinessData();
      return { removed: Object.fromEntries(before.map((c) => [c.table, c.count])) };
    },
  }),
  "admin.revokeSuperAdmin": op({
    label: "Revoke a Super Admin",
    schema: z.object({ userId: z.string() }),
    summarise: async ({ userId }) => {
      const user = await store.getUserBasics(userId);
      if (!user?.isSuperAdmin) throw new NotFoundError();
      if ((await store.countActiveSuperAdmins(userId)) === 0) throw new ForbiddenError("The last Super Admin cannot be disabled or demoted");
      return `${user.name} (${user.email}) stops being a Super Admin and remains an Administrator`;
    },
    execute: async ({ userId }) => {
      if ((await store.countActiveSuperAdmins(userId)) === 0) throw new ForbiddenError("The last Super Admin cannot be disabled or demoted");
      await store.setSuperAdminFlag(userId, false);
      return { revoked: userId };
    },
  }),
  "admin.deactivate": op({
    label: "Disable an administrator",
    schema: z.object({ userId: z.string() }),
    summarise: async ({ userId }) => {
      const user = await store.getUserBasics(userId);
      if (!user?.active) throw new NotFoundError();
      if (user.isSuperAdmin && (await store.countActiveSuperAdmins(userId)) === 0) throw new ForbiddenError("The last Super Admin cannot be disabled or demoted");
      return `Deactivate the administrator ${user.name} (${user.email}): they can no longer sign in; their open records are reassigned`;
    },
    execute: async ({ userId }, { approver }) => {
      const { deactivateUser } = await import("@/server/modules/admin/service");
      const reassigned = await deactivateUser(approver, userId, { fourEyesApproved: true });
      return { deactivated: userId, reassigned: reassigned.length };
    },
  }),
} as const;

export type OperationKey = keyof typeof OPERATIONS;

const isOperation = (k: string): k is OperationKey => k in OPERATIONS;

export interface Reauth {
  password?: string | null;
  code?: string | null;
}

/** Step 1: a Super Admin, re-authenticated, asks for the operation. Nothing is changed yet. */
export async function requestDestructive(ctx: AccessContext, action: OperationKey, payload: unknown, auth: Reauth) {
  assertSuperAdmin(ctx);
  await reauthenticate(ctx, auth);
  const operation = OPERATIONS[action];
  const parsed = operation.schema.parse(payload);
  const summary = await operation.summarise(parsed);
  if ((await store.countActiveSuperAdmins(ctx.userId)) === 0) {
    throw new ForbiddenError("This needs a second Super Admin's approval, and you are the only Super Admin. Appoint a second one under Administrators & Brand Admins first.");
  }
  const approval = await store.createApproval({
    action,
    summary,
    payload: parsed as object,
    requestedById: ctx.userId,
    expiresAt: new Date(Date.now() + APPROVAL_HOURS * 3_600_000),
  });
  await audit({ ctx, action: "CREATE", entity: "SetupApproval", entityId: approval.id, after: { action, summary, requestedById: ctx.userId } });
  return approval;
}

/** Step 2: a DIFFERENT Super Admin, re-authenticated, approves (the operation runs now) or rejects. */
export async function decideDestructive(ctx: AccessContext, id: string, decision: "APPROVED" | "REJECTED", auth: Reauth) {
  assertSuperAdmin(ctx);
  const approval = await store.getApproval(id);
  if (!approval) throw new NotFoundError();
  if (approval.requestedById === ctx.userId) throw new ForbiddenError("A second Super Admin must decide – you requested this operation yourself");
  await reauthenticate(ctx, auth);
  if (!isOperation(approval.action)) throw new BadRequestError("Unknown operation");
  if (!(await store.claimApproval(id, decision, ctx.userId))) throw new BadRequestError("This request is no longer waiting (decided, cancelled or expired)");

  let result: unknown = null;
  let failure: string | null = null;
  if (decision === "APPROVED") {
    try {
      const operation = OPERATIONS[approval.action];
      result = await operation.execute(operation.schema.parse(approval.payload), { requesterId: approval.requestedById, approver: ctx });
    } catch (e) {
      failure = e instanceof Error ? e.message : "The operation failed";
      result = { error: failure };
    }
    await store.setApprovalResult(id, result);
  }
  await audit({
    ctx,
    action: "UPDATE",
    entity: "SetupApproval",
    entityId: id,
    before: { status: "PENDING", action: approval.action, summary: approval.summary },
    after: { status: decision, action: approval.action, requestedById: approval.requestedById, approvedById: decision === "APPROVED" ? ctx.userId : null, rejectedById: decision === "REJECTED" ? ctx.userId : null, result },
  });
  if (failure) throw new BadRequestError(`Approved, but the operation failed: ${failure}`);
  return { summary: approval.summary, result };
}

/** The requester withdraws a request that is still waiting. */
export async function cancelDestructive(ctx: AccessContext, id: string) {
  assertSuperAdmin(ctx);
  const approval = await store.getApproval(id);
  if (!approval || approval.requestedById !== ctx.userId) throw new NotFoundError();
  if (!(await store.claimApproval(id, "CANCELLED", ctx.userId))) throw new BadRequestError("This request is no longer waiting");
  await audit({ ctx, action: "UPDATE", entity: "SetupApproval", entityId: id, before: { status: "PENDING" }, after: { status: "CANCELLED", action: approval.action } });
}

export async function approvalsPageData(ctx: AccessContext) {
  assertSuperAdmin(ctx);
  await store.expireApprovals();
  const rows = await store.listApprovals();
  const names = await store.userNames(rows.flatMap((r) => [r.requestedById, r.decidedById ?? ""]).filter(Boolean));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    label: isOperation(r.action) ? OPERATIONS[r.action].label : r.action,
    summary: r.summary,
    status: r.status,
    requestedBy: names.get(r.requestedById) ?? "—",
    requestedAt: r.requestedAt,
    decidedBy: r.decidedById ? (names.get(r.decidedById) ?? "—") : null,
    decidedAt: r.decidedAt,
    expiresAt: r.expiresAt,
    result: r.result,
    mine: r.requestedById === ctx.userId,
  }));
}

export const pendingSetupApprovals = (ctx: AccessContext) => (ctx.isSuperAdmin ? store.pendingApprovalCount() : Promise.resolve(0));
