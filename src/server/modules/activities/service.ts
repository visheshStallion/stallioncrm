import "server-only";
import { assertSameBrand } from "@/server/access/brand-tag";
import { delegateName } from "@/server/access/brand-owned";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { canWriteTo } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { advanceDealToStage } from "@/server/modules/deals/service";
import { notify } from "@/server/modules/notifications/service";
import { getActivity, usersWhoCanSee } from "./queries";
import { nextOccurrence } from "./recurrence";
import { activitySchema, completeSchema, TYPE_LABELS, type ActivityInput, type ActivityTypeKey, type CompleteInput } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any -- parents are loaded generically */

/** Brand-owned parents whose brand and region an activity inherits. Cases join with prompt 11. */
const BRAND_OWNED_PARENTS = ["Lead", "Deal", "Case"];

/**
 * Resolves the brand and region of a new activity from its parent. Brand-owned parents (lead, deal, case) are
 * loaded through the scoped client – a hidden parent is a 404. A shared Account needs an explicit brand context
 * that the user may write to.
 */
async function parentScope(ctx: AccessContext, parentType: string, parentId: string, brandId?: string, regionId?: string) {
  const db = scopedDb(ctx) as any;
  if (BRAND_OWNED_PARENTS.includes(parentType)) {
    const delegate = db[delegateName(parentType)];
    if (!delegate) throw new BadRequestError(`${parentType} records are not available yet`);
    const parent = await delegate.findUnique({ where: { id: parentId }, select: { brandId: true, regionId: true } });
    if (!parent) throw new NotFoundError();
    return parent as { brandId: string; regionId: string };
  }
  if (parentType === "Account") {
    const account = await db.account.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
    if (!account) throw new NotFoundError();
    if (!brandId || !regionId) throw new BadRequestError("Choose the brand and region this activity is for");
    if (!canWriteTo(ctx, brandId, regionId)) throw new ForbiddenError("You cannot create activities for this brand/region");
    return { brandId, regionId };
  }
  throw new BadRequestError("Unknown parent record type");
}

function overlapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("TEST_DRIVE_OVERLAP")) throw new BadRequestError("This vehicle is already booked for a test drive in that time");
  throw err;
}

/**
 * Creates a task, call, meeting, test drive or log entry. Brand and region come from the parent; the owner and
 * participants must be able to see the record. Test drives check the demo vehicle's availability (the DB
 * trigger is the authority – concurrent bookings cannot both succeed).
 */
export async function createActivity(ctx: AccessContext, input: ActivityInput) {
  const data = activitySchema.parse(input);
  const scope = await parentScope(ctx, data.parentType, data.parentId, data.brandId, data.regionId);
  assertCan(ctx, "activities", "create", scope);
  const db = scopedDb(ctx);

  const eligible = new Set((await usersWhoCanSee(ctx, scope.brandId, scope.regionId)).map((u) => u.id));
  const outsiders = data.participants.filter((p) => !eligible.has(p));
  if (outsiders.length) throw new ForbiddenError("A participant has no access to this record");

  if (data.type === "TEST_DRIVE" && data.productId) {
    const product = await db.product.findUnique({ where: { id: data.productId }, select: { brandId: true } });
    assertSameBrand(scope.brandId, product?.brandId, "The demo model");
  }
  const completed = data.completed || data.type === "EMAIL_LOG" || data.type === "WHATSAPP_LOG" || data.type === "SMS_LOG";
  const ownerId = data.ownerId ?? ctx.userId;
  const activity = await db.activity.create({
    data: {
      type: data.type,
      parentType: data.parentType,
      parentId: data.parentId,
      subject: data.subject,
      description: data.description,
      dueAt: data.dueAt ?? (data.type === "CALL" && completed ? new Date() : null),
      startAt: data.startAt,
      endAt: data.endAt,
      status: completed ? "COMPLETED" : "OPEN",
      completedAt: completed ? new Date() : null,
      priority: data.priority,
      participants: { users: data.participants },
      outcome: data.outcome,
      reminderAt: data.reminderAt,
      recurrence: data.type === "TASK" || data.type === "MEETING" ? data.recurrence : null,
      direction: data.direction,
      durationSec: data.durationSec,
      phone: data.phone,
      recordingUrl: data.recordingUrl,
      disposition: data.disposition,
      brandId: scope.brandId,
      regionId: scope.regionId,
      ownerId,
    },
    select: { id: true },
  });

  if (data.type === "TEST_DRIVE") {
    try {
      await db.testDrive.create({
        data: {
          activityId: activity.id,
          brandId: scope.brandId,
          productId: data.productId,
          vehicleVin: data.vehicleVin,
          vehiclePlate: data.vehiclePlate,
          location: data.location,
          licenceChecked: data.licenceChecked,
          licenceNumber: data.licenceNumber,
          indemnitySigned: data.indemnitySigned,
          startAt: data.startAt!,
          endAt: data.endAt!,
        },
      });
    } catch (err) {
      // Roll the booking back: no activity without its (rejected) test drive.
      await db.activity.delete({ where: { id: activity.id } }).catch(() => undefined);
      overlapError(err);
    }
  }

  const href = `/activities/${activity.id}`;
  const others = [...new Set([ownerId, ...data.participants])].filter((u) => u !== ctx.userId);
  await notify(ctx, others, { kind: "ASSIGNED", title: `${TYPE_LABELS[data.type as ActivityTypeKey]}: ${data.subject}`, body: `Assigned by ${ctx.user.name}`, href });
  return activity;
}

/** Quick-log of a finished call (post-call form). */
export async function logCall(ctx: AccessContext, input: Omit<ActivityInput, "type" | "completed">) {
  return createActivity(ctx, { ...input, type: "CALL", completed: true });
}

async function loadEditable(ctx: AccessContext, id: string) {
  const a = await getActivity(ctx, id);
  assertCan(ctx, "activities", "edit", a);
  return a;
}

/** Reschedule / edit an open activity. A test drive re-checks the vehicle's availability. */
export async function updateActivity(
  ctx: AccessContext,
  id: string,
  input: { subject?: string; description?: string | null; dueAt?: string | null; startAt?: string | null; endAt?: string | null; priority?: string; reminderAt?: string | null; ownerId?: string },
) {
  const a = await loadEditable(ctx, id);
  if (a.status !== "OPEN") throw new BadRequestError("Only open activities can be changed");
  const d = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
  const startAt = d(input.startAt);
  const endAt = d(input.endAt);
  const db = scopedDb(ctx);
  const newStart = startAt ?? (a.startAt ? new Date(a.startAt) : null);
  const newEnd = endAt ?? (a.endAt ? new Date(a.endAt) : null);
  if (newStart && newEnd && newEnd <= newStart) throw new BadRequestError("End must be after start");
  if (a.type === "TEST_DRIVE" && (startAt || endAt)) {
    const s = startAt ?? new Date(a.startAt!);
    const e = endAt ?? new Date(a.endAt!);
    await db.testDrive.update({ where: { activityId: id }, data: { startAt: s, endAt: e } }).catch(overlapError);
  }
  await db.activity.update({
    where: { id },
    data: {
      ...(input.subject !== undefined ? { subject: input.subject.trim() || a.subject } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority && ["LOW", "NORMAL", "HIGH"].includes(input.priority) ? { priority: input.priority } : {}),
      ...(d(input.dueAt) !== undefined ? { dueAt: d(input.dueAt) } : {}),
      ...(startAt !== undefined ? { startAt } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
      ...(d(input.reminderAt) !== undefined ? { reminderAt: d(input.reminderAt), reminderSentAt: null } : {}),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    },
    select: { id: true },
  });
  return { id };
}

/**
 * Completes (or cancels / marks no-show) an activity. Completing a test drive on a deal advances the deal from
 * Enquiry to Test Drive when the stage's requirements are met (stage history is written by the DB trigger).
 * A recurring task / meeting spawns its next occurrence.
 */
export async function completeActivity(ctx: AccessContext, id: string, input: CompleteInput = {}) {
  const a = await loadEditable(ctx, id);
  if (a.status !== "OPEN") throw new BadRequestError("This activity is already closed");
  const data = completeSchema.parse(input);
  const db = scopedDb(ctx);
  if (data.odometerStart !== null && data.odometerEnd !== null && data.odometerEnd < data.odometerStart) throw new BadRequestError("Odometer end must not be below the start");
  await db.activity.update({ where: { id }, data: { status: data.status, outcome: data.outcome ?? a.outcome, completedAt: new Date() }, select: { id: true } });

  let dealAdvanced = false;
  if (a.type === "TEST_DRIVE") {
    const td = await db.testDrive.update({
      where: { activityId: id },
      data: {
        cancelled: data.status !== "COMPLETED",
        odometerStart: data.odometerStart,
        odometerEnd: data.odometerEnd,
        feedbackRating: data.feedbackRating,
        followUpAt: data.followUpAt,
        ...(data.licenceChecked !== undefined ? { licenceChecked: data.licenceChecked } : {}),
        ...(data.indemnitySigned !== undefined ? { indemnitySigned: data.indemnitySigned } : {}),
      },
    });
    if (data.status === "COMPLETED" && a.parentType === "Deal") {
      try {
        dealAdvanced = await advanceDealToStage(ctx, a.parentId, "TEST_DRIVE", { testDriveDate: a.startAt!.slice(0, 10), ...(td.productId ? { modelId: td.productId } : {}) } as never);
      } catch (err) {
        if (!(err instanceof BadRequestError)) throw err; // requirements not met → the deal simply stays where it is
      }
    }
    if (data.status === "COMPLETED" && data.followUpAt) {
      await db.activity.create({
        data: { type: "TASK", parentType: a.parentType, parentId: a.parentId, subject: `Follow up test drive: ${a.subject}`, dueAt: data.followUpAt, brandId: a.brandId, regionId: a.regionId, ownerId: a.ownerId },
        select: { id: true },
      });
    }
  }

  let nextId: string | null = null;
  if (data.status === "COMPLETED" && a.recurrence && (a.type === "TASK" || a.type === "MEETING")) {
    const base = a.startAt ?? a.dueAt;
    const next = base ? nextOccurrence(a.recurrence, new Date(base)) : null;
    if (next) {
      const length = a.startAt && a.endAt ? new Date(a.endAt).getTime() - new Date(a.startAt).getTime() : 0;
      const created = await db.activity.create({
        data: {
          type: a.type as "TASK" | "MEETING",
          parentType: a.parentType,
          parentId: a.parentId,
          subject: a.subject,
          description: a.description,
          priority: a.priority,
          recurrence: a.recurrence,
          ...(a.startAt ? { startAt: next, endAt: new Date(next.getTime() + length) } : { dueAt: next }),
          brandId: a.brandId,
          regionId: a.regionId,
          ownerId: a.ownerId,
        },
        select: { id: true },
      });
      nextId = created.id;
    }
  }
  return { id, dealAdvanced, nextId };
}

/**
 * Lead conversion hook: the lead's activities move to the new deal (same brand and region by construction).
 */
export async function moveLeadActivitiesToDeal(ctx: AccessContext, leadId: string, dealId: string) {
  const res = await scopedDb(ctx).activity.updateMany({ where: { parentType: "Lead", parentId: leadId }, data: { parentType: "Deal", parentId: dealId } });
  return res.count;
}

/**
 * Reminders: creates an in-app notification for every open activity whose reminder time has passed. Run by the
 * scheduler (cron route) with a system context; idempotent through `reminderSentAt`.
 */
export async function processReminders(ctx: AccessContext, now = new Date()) {
  const db = scopedDb(ctx);
  const due = await db.activity.findMany({
    where: { status: "OPEN", reminderAt: { lte: now }, reminderSentAt: null },
    select: { id: true, subject: true, type: true, ownerId: true, startAt: true, dueAt: true },
    take: 500,
  });
  for (const a of due) {
    await notify(ctx, [a.ownerId], { kind: "REMINDER", title: `Reminder: ${a.subject}`, body: TYPE_LABELS[a.type as ActivityTypeKey], href: `/activities/${a.id}` });
    await db.activity.update({ where: { id: a.id }, data: { reminderSentAt: now }, select: { id: true } });
  }
  return due.length;
}
