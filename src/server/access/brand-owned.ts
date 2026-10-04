/**
 * Brand-owned models are detected from the Prisma schema – any model with brandId + regionId +
 * ownerId scalar fields. Nobody has to remember to register a new model: scopedDb scopes it and
 * the RLS coverage test fails until its migration enables RLS.
 */
import { Prisma } from "@prisma/client";

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

const MIXIN = ["brandId", "regionId", "ownerId"] as const;

const models = Prisma.dmmf.datamodel.models;

export const BRAND_OWNED_MODELS: ReadonlySet<string> = new Set(
  models
    .filter((m) => MIXIN.every((f) => m.fields.some((x) => x.name === f && x.kind === "scalar")))
    .map((m) => m.name),
);

export function isBrandOwnedModel(model: string | undefined): boolean {
  return !!model && BRAND_OWNED_MODELS.has(model);
}

const modelByName = new Map<string, DmmfModel>(models.map((m) => [m.name, m]));

export interface RelationInfo {
  /** Target model name. */
  type: string;
  isList: boolean;
}

/** Relation fields of `model`, keyed by field name. */
export function relationsOf(model: string): Map<string, RelationInfo> {
  const m = modelByName.get(model);
  const out = new Map<string, RelationInfo>();
  for (const f of m?.fields ?? []) {
    if (f.kind === "object") out.set(f.name, { type: f.type, isList: f.isList });
  }
  return out;
}

/** Prisma delegate name for a model: "SalesOrder" → "salesOrder". */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Brand-owned models that have a given scalar field (e.g. "accountId" → models linked to customers). */
export function brandOwnedModelsWith(field: string): string[] {
  return models
    .filter((m) => BRAND_OWNED_MODELS.has(m.name) && m.fields.some((f) => f.name === field && f.kind === "scalar"))
    .map((m) => m.name);
}
