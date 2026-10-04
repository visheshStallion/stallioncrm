import "server-only";
import { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { isManagerOf } from "@/server/access/visibility";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { assertAdmin } from "@/server/modules/admin/guard";
import {
  ALL_REQUIREMENT_KEYS,
  allowedTargets,
  canTransition,
  isRequirementField,
  missingRequirements,
  requirementLabel,
  type RequirementCheck,
} from "./blueprint";
import { getDeal, getPipeline } from "./queries";
import { createDealSchema, dealFieldsSchema, updateDealSchema, type CreateDealInput, type UpdateDealInput } from "./schema";

/** Maps DB integrity errors (unique VIN per brand, pipeline/stage triggers) to readable messages. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Duck-typed: errors raised inside the scoped client's transaction are not always the same class instance.
    const e = err as { code?: string; message?: string };
    const msg = e.message ?? "";
    // VIN per brand is the only unique constraint on Deal (the constraint name is not reported under the RLS role).
    if (e.code === "P2002") {
      throw new BadRequestError("This VIN / chassis number is already used by another deal of this brand");
    }
    if (msg.includes("does not belong to the deal")) throw new BadRequestError("The pipeline / stage does not belong to the deal's brand");
    throw err;
  }
}

async function assertRefs(ctx: AccessContext, brandId: string, data: { modelId?: string | null; accountId?: string | null; contactId?: string | null }) {
  const db = scopedDb(ctx);
  if (data.modelId) {
    const p = await db.product.findUnique({ where: { id: data.modelId }, select: { brandId: true } });
    if (!p || p.brandId !== brandId) throw new BadRequestError("The model must belong to the deal's brand");
  }
  if (data.accountId && !(await db.account.findFirst({ where: { id: data.accountId, deletedAt: null }, select: { id: true } }))) {
    throw new BadRequestError("Unknown account");
  }
  if (data.contactId && !(await db.contact.findFirst({ where: { id: data.contactId, deletedAt: null }, select: { id: true } }))) {
    throw new BadRequestError("Unknown contact");
  }
}

/**
 * Creates a deal in the first stage of the brand's pipeline (the DB trigger picks the default pipeline when
 * none is given and rejects a pipeline of another brand).
 */
export async function createDeal(ctx: AccessContext, input: CreateDealInput) {
  const data = createDealSchema.parse(input);
  assertCan(ctx, "deals", "create", { brandId: data.brandId, regionId: data.regionId });
  await assertRefs(ctx, data.brandId, data);
  return guarded(() => scopedDb(ctx).deal.create({ data: { ...data, ownerId: data.ownerId ?? ctx.userId }, select: { id: true } }));
}

/**
 * Edits deal fields. Stage moves go through moveDealStage (Blueprint), owner changes through changeDealOwner,
 * region changes are for managers, and brand changes go through the Brand Change approval (prompt 08).
 */
export async function updateDeal(ctx: AccessContext, id: string, input: UpdateDealInput & { regionId?: string; brandId?: string }) {
  const current = await getDeal(ctx, id);
  assertCan(ctx, "deals", "edit", current);
  if (input.brandId && input.brandId !== current.brandId) {
    throw new ForbiddenError("The brand of a deal can only be changed through the Brand Change approval");
  }
  const data: Record<string, unknown> = updateDealSchema.parse(input);
  for (const k of Object.keys(data)) if (!(k in input)) delete data[k];
  if (input.regionId && input.regionId !== current.regionId) {
    if (!isManagerOf(ctx, current.brandId, current.regionId)) throw new ForbiddenError("Only managers can change the region of a deal");
    data.regionId = input.regionId;
  }
  await assertRefs(ctx, current.brandId, data);
  return guarded(() => scopedDb(ctx).deal.update({ where: { id }, data, select: { id: true } }));
}

/** Owner change – scopedDb verifies that the new owner works in the deal's brand-region. */
export async function changeDealOwner(ctx: AccessContext, id: string, ownerId: string) {
  const current = await getDeal(ctx, id);
  assertCan(ctx, "deals", "edit", current);
  return scopedDb(ctx).deal.update({ where: { id }, data: { ownerId }, select: { id: true } });
}

/** Named Blueprint checks. A check whose module does not exist yet is left undefined (= not enforced). */
async function runChecks(ctx: AccessContext, dealId: string, keys: string[]): Promise<Partial<Record<RequirementCheck, boolean>>> {
  const out: Partial<Record<RequirementCheck, boolean>> = {};
  if (keys.includes("quote") && Prisma.dmmf.datamodel.models.some((m) => m.name === "Quote")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Quote arrives with prompt 06
    out.quote = (await (scopedDb(ctx) as any).quote.count({ where: { dealId } })) > 0;
  }
  return out;
}

/**
 * Blueprint stage move: checks the transition (previous / next / lost, or the stage's configured transitions;
 * managers of the deal's brand may jump) and the target stage's requirements, saving any values supplied with
 * the move (the Blueprint dialog) in the same update. Stage history is written by a DB trigger.
 */
export async function moveDealStage(ctx: AccessContext, id: string, toStageId: string, values: UpdateDealInput = {}) {
  const current = await getDeal(ctx, id);
  assertCan(ctx, "deals", "edit", current);
  const pipeline = await getPipeline(ctx, current.pipelineId);
  const from = pipeline?.stages.find((s) => s.id === current.stageId);
  const to = pipeline?.stages.find((s) => s.id === toStageId);
  if (!pipeline || !from || !to) throw new BadRequestError("Unknown stage for this deal's pipeline");
  if (from.id === to.id) return { id, stage: to.key };

  const manager = isManagerOf(ctx, current.brandId, current.regionId);
  if (!canTransition(pipeline.stages, from, to, manager)) {
    const options = allowedTargets(pipeline.stages, from).map((k) => pipeline.stages.find((s) => s.key === k)?.name);
    throw new ForbiddenError(`Blueprint: from ${from.name} a deal can move to ${options.join(", ") || "no other stage"}`);
  }

  // Only requirement fields can be set through a stage move.
  const sent = Object.fromEntries(Object.entries(values).filter(([k]) => isRequirementField(k)));
  const parsed: Record<string, unknown> = dealFieldsSchema.partial().parse(sent);
  for (const k of Object.keys(parsed)) if (!(k in sent)) delete parsed[k];
  await assertRefs(ctx, current.brandId, parsed);

  const missing = missingRequirements(to, { ...current, ...parsed }, await runChecks(ctx, id, to.requiredFields));
  if (missing.length) throw new BadRequestError(`Blueprint: to enter ${to.name} you need: ${missing.map(requirementLabel).join(", ")}`);

  await guarded(() => scopedDb(ctx).deal.update({ where: { id }, data: { ...parsed, stageId: to.id }, select: { id: true } }));
  return { id, stage: to.key };
}

// ───────────────────────────── pipeline setup (administrators) ─────────────────────────────

export interface StageInput {
  name: string;
  probability: number;
  maxDaysInStage: number | null;
  requiredFields: string[];
  /** null = default rule (previous / next / lost) */
  allowedTransitions: string[] | null;
}

function cleanStage(input: StageInput, validKeys: string[]) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new BadRequestError("Stage name must be 1–60 characters");
  if (!Number.isInteger(input.probability) || input.probability < 0 || input.probability > 100) throw new BadRequestError("Probability must be 0–100");
  if (input.maxDaysInStage !== null && (!Number.isInteger(input.maxDaysInStage) || input.maxDaysInStage < 1 || input.maxDaysInStage > 3650)) {
    throw new BadRequestError("Max days in stage must be 1–3650 (or empty)");
  }
  return {
    name,
    probability: input.probability,
    maxDaysInStage: input.maxDaysInStage,
    requiredFields: [...new Set(input.requiredFields)].filter((k) => ALL_REQUIREMENT_KEYS.includes(k)),
    allowedTransitions: input.allowedTransitions === null ? Prisma.DbNull : [...new Set(input.allowedTransitions)].filter((k) => validKeys.includes(k)),
  };
}

export async function updatePipelineStage(ctx: AccessContext, stageId: string, input: StageInput) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const before = await db.pipelineStage.findUnique({ where: { id: stageId }, include: { pipeline: { include: { stages: { select: { key: true } } } } } });
  if (!before) throw new NotFoundError();
  const data = cleanStage(input, before.pipeline.stages.map((s) => s.key));
  const after = await db.pipelineStage.update({ where: { id: stageId }, data });
  await audit({ ctx, action: "UPDATE", entity: "PipelineStage", entityId: stageId, brandId: before.pipeline.brandId, before: { ...before, pipeline: undefined }, after });
  return after;
}

/** Adds an OPEN stage before the closing stages. */
export async function addPipelineStage(ctx: AccessContext, pipelineId: string, name: string) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId }, include: { stages: true } });
  if (!pipeline) throw new NotFoundError();
  const label = name.trim();
  const key = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!key || label.length > 60) throw new BadRequestError("Stage name must be 1–60 letters / digits");
  if (pipeline.stages.some((s) => s.key === key)) throw new BadRequestError("A stage with this name already exists");
  const open = pipeline.stages.filter((s) => s.type === "OPEN");
  const order = Math.max(0, ...open.map((s) => s.order)) + 1;
  for (const s of pipeline.stages.filter((x) => x.type !== "OPEN").sort((a, b) => b.order - a.order)) {
    await db.pipelineStage.update({ where: { id: s.id }, data: { order: s.order + 1 } });
  }
  const stage = await db.pipelineStage.create({ data: { pipelineId, key, name: label, order, probability: 50, type: "OPEN" } });
  await audit({ ctx, action: "CREATE", entity: "PipelineStage", entityId: stage.id, brandId: pipeline.brandId, after: stage });
  return stage;
}

/** Removes an OPEN stage that no deal is in. */
export async function deletePipelineStage(ctx: AccessContext, stageId: string) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const stage = await db.pipelineStage.findUnique({ where: { id: stageId }, include: { pipeline: true, _count: { select: { deals: true } } } });
  if (!stage) throw new NotFoundError();
  if (stage.type !== "OPEN") throw new ForbiddenError("Closing stages cannot be removed");
  if (stage._count.deals > 0) throw new ForbiddenError(`${stage._count.deals} deal(s) are in this stage – move them first`);
  await db.pipelineStage.delete({ where: { id: stageId } });
  await audit({ ctx, action: "DELETE", entity: "PipelineStage", entityId: stageId, brandId: stage.pipeline.brandId, before: stage });
}
