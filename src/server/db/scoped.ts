/**
 * scopedDb(ctx) – the ONLY database client application code uses.
 *
 * Layer 1 (Prisma extension, this file):
 *   • reads / updates / deletes on brand-owned models get `brandScopeWhere(ctx)` + `deletedAt: null`
 *     ANDed into their `where` – including list relations pulled in via include/select/_count;
 *   • creates are validated (brand + region inside the user's territories), territory resolved,
 *     owner / createdBy / updatedBy stamped;
 *   • updates that move a record re-validate and re-resolve the territory; brand changes need scope ALL
 *     (everyone else goes through the brand-change approval, prompt 08);
 *   • INACTIVE brands: creates rejected, existing records read-only (bulk writes skip them);
 *   • brand-TAGGED master data (Product, PriceBook, VehicleStockRef) is filtered to the user's brands;
 *   • nested writes INTO brand-owned models are rejected (they would skip validation);
 *   • create / update / delete on brand-owned models are audited.
 * Layer 2 (Postgres RLS): every operation – including $queryRaw – runs in a transaction as role
 *   `stallion_rls` with the user's context in `app.*` settings, so a bug in layer 1 still cannot leak.
 *
 * Limitation: interactive `$transaction(async tx => …)` is not supported on the scoped client
 * (each operation opens its own transaction). Use the batch form or a service-level helper.
 */
import "server-only";
import type { AuditAction, Prisma } from "@prisma/client";
import {
  delegateName,
  isBrandOwnedModel,
  relationsOf,
} from "@/server/access/brand-owned";
import { brandTagWhere, isBrandTaggedModel } from "@/server/access/brand-tag";
import { ForbiddenError } from "@/server/access/errors";
import { resolveTerritory } from "@/server/access/territory";
import type { AccessContext } from "@/server/access/types";
import { loadAccessContext } from "@/server/access/context";
import { brandScopeWhere, canWriteTo, hasTerritoryAccess } from "@/server/access/visibility";
import { audit } from "./audit";
import { rlsSessionQueries } from "./rls";
import { unsafeDb } from "./unsafe";

// The global `omit` on unsafeDb changes its type; territory helpers only need the delegates.
const systemDb = unsafeDb as unknown as Prisma.TransactionClient;

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma extension args are untyped by design */
type Obj = Record<string, any>;

const READ_OR_BULK = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const UNIQUE = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const NESTED_WRITE_OPS = new Set([
  "create",
  "createMany",
  "connectOrCreate",
  "upsert",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "set",
]);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function andWhere(where: Obj | undefined, extra: Obj): Obj {
  if (!where || Object.keys(where).length === 0) return extra;
  return { AND: [where, extra] };
}

/** For WhereUniqueInput: keep the unique keys at top level, append the scope to AND. */
function andWhereUnique(where: Obj, extra: Obj): Obj {
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...existing, extra] };
}

/** The filter injected for brand-owned models. */
export function scopeFilter(ctx: AccessContext): Obj {
  const scope = brandScopeWhere(ctx);
  return Object.keys(scope).length === 0
    ? { deletedAt: null }
    : { AND: [scope, { deletedAt: null }] };
}

/** Recursively scopes list relations to brand-owned models inside include / select / _count. */
function scopeSelection(model: string, selection: Obj | undefined, filter: Obj): Obj | undefined {
  if (!isObj(selection)) return selection;
  const relations = relationsOf(model);
  const out: Obj = {};
  for (const [key, value] of Object.entries(selection)) {
    if (key === "_count" && isObj(value) && isObj(value.select)) {
      const sel: Obj = {};
      for (const [rel, v] of Object.entries(value.select)) {
        const info = relations.get(rel);
        if (info && isBrandOwnedModel(info.type) && v) {
          sel[rel] = { where: andWhere(isObj(v) ? v.where : undefined, filter) };
        } else sel[rel] = v;
      }
      out[key] = { ...value, select: sel };
      continue;
    }
    const info = relations.get(key);
    if (!info || !value) {
      out[key] = value;
      continue;
    }
    const nested: Obj = isObj(value) ? { ...value } : {};
    if (info.isList && isBrandOwnedModel(info.type)) {
      nested.where = andWhere(nested.where, filter);
    }
    if (nested.include) nested.include = scopeSelection(info.type, nested.include, filter);
    if (nested.select) nested.select = scopeSelection(info.type, nested.select, filter);
    // A to-one relation to a brand-owned model cannot take a `where`; RLS (layer 2) covers it.
    out[key] = Object.keys(nested).length === 0 && value === true ? true : nested;
  }
  return out;
}

function assertNoNestedBrandWrites(model: string, data: unknown): void {
  const rows = Array.isArray(data) ? data : [data];
  const relations = relationsOf(model);
  for (const row of rows) {
    if (!isObj(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      const info = relations.get(key);
      if (!info || !isObj(value)) continue;
      if (isBrandOwnedModel(info.type) && Object.keys(value).some((op) => NESTED_WRITE_OPS.has(op))) {
        throw new ForbiddenError(
          `Nested writes into ${info.type} are not allowed; use scopedDb.${delegateName(info.type)} directly`,
        );
      }
    }
  }
}

function scalar(v: unknown): unknown {
  return isObj(v) && "set" in v ? v.set : v;
}

/** Inactive brands (BUSINESS_CONTEXT / prompt 01): no new records, existing records read-only. */
async function assertBrandWritable(brandId: string, purpose: "create" | "modify"): Promise<void> {
  const brand = await systemDb.brand.findUnique({ where: { id: brandId }, select: { code: true, status: true } });
  if (!brand) throw new ForbiddenError("Unknown brand");
  if (brand.status === "INACTIVE") {
    throw new ForbiddenError(
      purpose === "create"
        ? `Brand ${brand.code} is inactive – no new records`
        : `Records of inactive brand ${brand.code} are read-only`,
    );
  }
}

/** The acting user id for createdBy/updatedBy (null for system contexts such as web-to-lead intake). */
const actor = (ctx: AccessContext) => (ctx.system ? null : ctx.userId);

/**
 * Ownership rule: a record can only be owned by an ACTIVE user who has territory access to the
 * record's brand/region (or scope ALL). Owner = the acting user needs no extra check.
 */
async function assertOwnerEligible(
  ctx: AccessContext,
  ownerId: unknown,
  pairs: Array<{ brandId: string; regionId: string }>,
): Promise<void> {
  if (typeof ownerId !== "string" || (ownerId === ctx.userId && !ctx.system)) return;
  const owner = await loadAccessContext(ownerId);
  if (!owner) throw new ForbiddenError("The owner must be an active user");
  for (const p of pairs) {
    if (!hasTerritoryAccess(owner, p.brandId, p.regionId)) {
      throw new ForbiddenError(`${owner.user.name} has no access to this brand/region and cannot own the record`);
    }
  }
}

/** Bulk writes skip records of inactive brands. */
const NOT_INACTIVE_BRAND = { brand: { status: { not: "INACTIVE" } } };

async function prepareCreateData(model: string, data: Obj, ctx: AccessContext): Promise<Obj> {
  if ("brand" in data || "region" in data || "territory" in data) {
    throw new ForbiddenError(`${model}: set brandId / regionId as scalars (territory is resolved automatically)`);
  }
  const brandId = data.brandId;
  const regionId = data.regionId;
  if (typeof brandId !== "string" || typeof regionId !== "string") {
    throw new ForbiddenError(`${model}: brandId and regionId are mandatory`);
  }
  if (!canWriteTo(ctx, brandId, regionId)) {
    throw new ForbiddenError("You cannot create records for this brand/region");
  }
  await assertBrandWritable(brandId, "create");
  const ownerId = data.ownerId ?? ctx.userId;
  if (!ownerId) throw new ForbiddenError(`${model}: ownerId is required`);
  await assertOwnerEligible(ctx, ownerId, [{ brandId, regionId }]);
  return {
    ...data,
    territoryId: await resolveTerritory(systemDb, brandId, regionId),
    ownerId,
    createdById: actor(ctx),
    updatedById: actor(ctx),
  };
}

async function prepareUpdateData(
  model: string,
  where: Obj,
  data: Obj,
  ctx: AccessContext,
  filter: Obj,
): Promise<Obj> {
  if ("brand" in data || "region" in data || "territory" in data || "territoryId" in data) {
    throw new ForbiddenError(`${model}: change brandId / regionId as scalars (territory is resolved automatically)`);
  }
  const out: Obj = { ...data, updatedById: actor(ctx) };
  const moves = "brandId" in data || "regionId" in data;
  const reowns = "ownerId" in data;
  if (!moves && !reowns) return out;

  const delegate = (unsafeDb as any)[delegateName(model)];
  const existing = await delegate.findFirst({
    where: andWhere(where, filter),
    select: { brandId: true, regionId: true },
  });
  if (!existing) return out; // the scoped update itself will fail with "record not found"
  if (!moves) {
    await assertOwnerEligible(ctx, scalar(data.ownerId), [existing]);
    return out;
  }

  const brandId = (scalar(data.brandId) as string | undefined) ?? existing.brandId;
  const regionId = (scalar(data.regionId) as string | undefined) ?? existing.regionId;
  if (brandId !== existing.brandId && ctx.scope !== "ALL") {
    throw new ForbiddenError("Changing the brand of a record requires approval");
  }
  if (!canWriteTo(ctx, brandId, regionId)) {
    throw new ForbiddenError("You cannot move records to this brand/region");
  }
  if (brandId !== existing.brandId) await assertBrandWritable(brandId, "create");
  if (reowns) await assertOwnerEligible(ctx, scalar(data.ownerId), [{ brandId, regionId }]);
  out.territoryId = await resolveTerritory(systemDb, brandId, regionId);
  return out;
}

/** Rewrites args for a brand-owned model; returns the `before` snapshot for audited single writes. */
async function scopeBrandOwnedArgs(
  model: string,
  operation: string,
  args: Obj,
  ctx: AccessContext,
  filter: Obj,
): Promise<{ args: Obj; before?: Obj | null }> {
  const a: Obj = { ...args };

  if (READ_OR_BULK.has(operation)) {
    a.where = andWhere(a.where, filter);
    if (operation.startsWith("updateMany")) {
      if (isObj(a.data) && ["brandId", "regionId", "territoryId", "brand", "region"].some((k) => k in a.data)) {
        throw new ForbiddenError("Bulk updates cannot move records between brands/regions");
      }
      a.data = { ...a.data, updatedById: actor(ctx) };
      if (isObj(a.data) && "ownerId" in a.data) {
        const pairs = await (unsafeDb as any)[delegateName(model)].findMany({
          where: a.where,
          distinct: ["brandId", "regionId"],
          select: { brandId: true, regionId: true },
        });
        await assertOwnerEligible(ctx, scalar(a.data.ownerId), pairs);
      }
    }
    if (operation.startsWith("updateMany") || operation === "deleteMany") {
      a.where = andWhere(a.where, NOT_INACTIVE_BRAND);
    }
    return { args: a };
  }

  if (UNIQUE.has(operation)) {
    const originalWhere = a.where;
    a.where = andWhereUnique(a.where ?? {}, filter);
    let before: Obj | null | undefined;
    if (operation === "update" || operation === "delete" || operation === "upsert") {
      before = await (unsafeDb as any)[delegateName(model)].findFirst({ where: a.where });
      if (before) await assertBrandWritable(before.brandId, "modify");
    }
    if (operation === "update") {
      a.data = await prepareUpdateData(model, originalWhere, a.data ?? {}, ctx, filter);
    }
    if (operation === "upsert") {
      a.create = await prepareCreateData(model, a.create ?? {}, ctx);
      a.update = await prepareUpdateData(model, originalWhere, a.update ?? {}, ctx, filter);
    }
    return { args: a, before };
  }

  if (CREATES.has(operation)) {
    if (Array.isArray(a.data)) {
      a.data = await Promise.all(a.data.map((d: Obj) => prepareCreateData(model, d, ctx)));
    } else {
      a.data = await prepareCreateData(model, a.data ?? {}, ctx);
    }
    return { args: a };
  }

  return { args: a };
}

/** Models with workflow rules (src/server/modules/workflow/modules.ts). */
const WORKFLOW_MODELS = new Set(["Lead", "Deal", "Quote", "SalesOrder"]);

const AUDITED: Record<string, AuditAction> = {
  create: "CREATE",
  createMany: "CREATE",
  createManyAndReturn: "CREATE",
  update: "UPDATE",
  updateMany: "UPDATE",
  updateManyAndReturn: "UPDATE",
  upsert: "UPDATE",
  delete: "DELETE",
  deleteMany: "DELETE",
};

async function auditWrite(
  ctx: AccessContext,
  model: string,
  operation: string,
  args: Obj,
  before: Obj | null | undefined,
  result: any,
): Promise<void> {
  const action =
    operation === "upsert" && !before ? "CREATE" : AUDITED[operation];
  if (!action) return;
  const single = isObj(result) && !("count" in result && Object.keys(result).length === 1);
  if (single && !Array.isArray(result)) {
    const record = operation === "delete" ? before ?? result : result;
    await audit({
      ctx,
      action,
      entity: model,
      entityId: record?.id ?? before?.id ?? null,
      brandId: record?.brandId ?? before?.brandId ?? null,
      before: operation === "create" ? undefined : before,
      after: operation === "delete" ? undefined : result,
    });
    return;
  }
  const count = Array.isArray(result) ? result.length : result?.count;
  await audit({ ctx, action, entity: model, after: { bulk: true, count, where: args.where } });
}

const cache = new WeakMap<AccessContext, ReturnType<typeof buildScopedDb>>();

function buildScopedDb(ctx: AccessContext) {
  const filter = scopeFilter(ctx);
  return unsafeDb.$extends({
    name: "brand-scope",
    query: {
      async $allOperations({ model, operation, args, query }) {
        let finalArgs: Obj = (args ?? {}) as Obj;
        let before: Obj | null | undefined;

        if (model) {
          if (isObj(finalArgs.data) || Array.isArray(finalArgs.data)) {
            assertNoNestedBrandWrites(model, finalArgs.data);
          }
          if (isObj(finalArgs.create)) assertNoNestedBrandWrites(model, finalArgs.create);
          if (isObj(finalArgs.update)) assertNoNestedBrandWrites(model, finalArgs.update);

          if (isBrandOwnedModel(model)) {
            ({ args: finalArgs, before } = await scopeBrandOwnedArgs(model, operation, finalArgs, ctx, filter));
          } else if (isBrandTaggedModel(model) && ctx.scope !== "ALL") {
            // Brand-tagged master data (products, price books, stock): only the user's brands.
            if (READ_OR_BULK.has(operation)) finalArgs = { ...finalArgs, where: andWhere(finalArgs.where, brandTagWhere(ctx)) };
            else if (UNIQUE.has(operation)) finalArgs = { ...finalArgs, where: andWhereUnique(finalArgs.where ?? {}, brandTagWhere(ctx)) };
          }
          if (finalArgs.include) finalArgs = { ...finalArgs, include: scopeSelection(model, finalArgs.include, filter) };
          if (finalArgs.select) finalArgs = { ...finalArgs, select: scopeSelection(model, finalArgs.select, filter) };
        }

        const [, , result] = await unsafeDb.$transaction([
          ...rlsSessionQueries(unsafeDb, ctx),
          query(finalArgs) as any,
        ]);

        if (model && isBrandOwnedModel(model) && operation in AUDITED) {
          await auditWrite(ctx, model, operation, finalArgs, before, result);
        }
        // Workflow rules (prompt 08): single creates / updates of rule-enabled modules enqueue matching rules.
        if (model && WORKFLOW_MODELS.has(model) && (operation === "create" || operation === "update") && !ctx.automation) {
          const { onRecordWritten } = await import("@/server/modules/workflow/engine");
          await onRecordWritten(ctx, model, operation, before, result, isObj(finalArgs.data) ? finalArgs.data : {});
        }
        return result;
      },
    },
  });
}

/** Returns the brand-scoped client for this access context (memoised per context object). */
export function scopedDb(ctx: AccessContext) {
  let db = cache.get(ctx);
  if (!db) {
    db = buildScopedDb(ctx);
    cache.set(ctx, db);
  }
  return db;
}

export type ScopedDb = ReturnType<typeof scopedDb>;
