/**
 * Custom fields & layouts (prompt 12) – database side of the pure engine in engine.ts.
 *
 *  • Definitions are read through scopedDb: RLS returns group fields and the fields of the caller's own brands,
 *    so a brand-specific field (and its values) is invisible to other brands' users.
 *  • `prepareCustomFields` is called by the create / update services of leads, deals, cases, accounts and
 *    contacts: it validates the input against the runtime schema, applies the layout rules and returns the JSON
 *    to store.
 *  • `presentCustomFields` returns what a viewer may see of a record's custom fields (field-level security:
 *    hidden / masked per profile under the key `cf_<apiName>`), including computed formulas.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { fieldAccess } from "@/server/access/field-mask";
import { NotFoundError } from "@/server/access/errors";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { parseFormula } from "@/server/automation/formula";
import { audit, scopedDb } from "@/server/db";
import { createCustomFieldIndex, dropCustomFieldIndex } from "@/server/db/customization-system";
import { BadRequestError } from "@/server/errors";
import type { FieldDef } from "@/server/list/filters";
import {
  API_NAME,
  applyRules,
  BRANDED_MODULES,
  cfKey,
  computeFormulas,
  CUSTOM_MODULES,
  EMPTY_LAYOUT,
  FIELD_TYPES,
  fieldsFor,
  layoutSchema,
  LOOKUP_TARGETS,
  pickLayout,
  ruleValues,
  validateCustomFields,
  type CustomFieldDef,
  type CustomFieldType,
  type CustomModule,
  type CustomValues,
  type LayoutDef,
} from "./engine";

const toDef = (r: { id: string; module: string; apiName: string; label: string; type: string; options: string[]; lookupTarget: string | null; formula: string | null; brandId: string | null; required: boolean; active: boolean; position: number }): CustomFieldDef => ({ ...r, type: r.type as CustomFieldType });

/** Every definition the caller may see (group + own brands). */
export async function listCustomFields(ctx: AccessContext, module?: string) {
  return scopedDb(ctx).customField.findMany({ where: module ? { module } : {}, include: { brand: { select: { code: true } } }, orderBy: [{ module: "asc" }, { position: "asc" }, { label: "asc" }] });
}

/** Active definitions for one module, as the engine wants them. */
export async function definitions(ctx: AccessContext, module: CustomModule): Promise<CustomFieldDef[]> {
  return (await scopedDb(ctx).customField.findMany({ where: { module, active: true } })).map(toDef);
}

export async function getLayout(ctx: AccessContext, module: string, brandId: string | null): Promise<LayoutDef> {
  const layouts = await scopedDb(ctx).layout.findMany({ where: { module } });
  const picked = pickLayout(layouts, brandId);
  const parsed = picked ? layoutSchema.safeParse(picked.definition) : null;
  return parsed?.success ? parsed.data : EMPTY_LAYOUT;
}

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Validates and returns the custom-field JSON to store for a record.
 *   standard – the record's standard values after the change (for layout rules and "required" checks)
 *   input    – the custom values sent by the client (undefined = none sent)
 *   current  – stored values (updates): fields that were not sent keep their value
 * Also enforces layout "required" on standard fields. Throws BadRequestError listing every problem.
 */
export async function prepareCustomFields(
  ctx: AccessContext,
  module: CustomModule,
  brandId: string | null,
  standard: Record<string, unknown>,
  input: unknown,
  current?: unknown,
): Promise<Prisma.InputJsonValue> {
  const defs = fieldsFor(await definitions(ctx, module), module, brandId);
  const layout = await getLayout(ctx, module, brandId);
  const stored = (current && typeof current === "object" ? current : {}) as Record<string, unknown>;
  const sent = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // Nothing configured and nothing sent: keep what is there (fast path for the common case).
  if (defs.length === 0 && layout.rules.length === 0 && layout.required.length === 0) return stored as Prisma.InputJsonValue;
  const merged = { ...stored, ...sent };
  const { hidden, required } = applyRules(layout, ruleValues(standard, merged));
  const { values, errors } = validateCustomFields(defs, merged, { hidden, extraRequired: required });
  for (const key of required) {
    if (key.startsWith("cf_")) continue; // handled above
    if (empty(standard[key])) errors.push(`${key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} is required`);
  }
  // Lookups must point at something the user can see (scopedDb: products of own brands, active users).
  const db = scopedDb(ctx);
  for (const d of defs) {
    const v = values[d.apiName];
    if (d.type !== "LOOKUP" || typeof v !== "string" || !v) continue;
    const found = d.lookupTarget === "products" ? await db.product.findFirst({ where: { id: v, ...(brandId ? { brandId } : {}) }, select: { id: true } }) : await db.user.findFirst({ where: { id: v, active: true }, select: { id: true } });
    if (!found) errors.push(`${d.label}: unknown ${d.lookupTarget === "products" ? "product of this brand" : "user"}`);
  }
  if (errors.length) throw new BadRequestError(errors.join("; "));
  // Values of hidden fields are cleared, so that a rule that hides a field also removes stale data.
  for (const d of defs) if (hidden.has(cfKey(d.apiName))) values[d.apiName] = d.type === "MULTI_PICKLIST" ? [] : d.type === "BOOLEAN" ? false : null;
  return values as Prisma.InputJsonValue;
}

export interface PresentedField {
  key: string;
  apiName: string;
  label: string;
  type: CustomFieldType;
  value: CustomValues[string];
  masked: boolean;
  brandSpecific: boolean;
}

/** Custom fields of a record as the viewer may see them (hidden by profile → omitted; masked → "****"). */
export async function presentCustomFields(ctx: AccessContext, module: CustomModule, brandId: string | null, record: Record<string, unknown>): Promise<PresentedField[]> {
  const defs = fieldsFor(await definitions(ctx, module), module, brandId);
  if (defs.length === 0) return [];
  const stored = ((record.customFields && typeof record.customFields === "object" ? record.customFields : {}) ?? {}) as CustomValues;
  const values = { ...stored, ...computeFormulas(defs, record, stored) };
  const layout = await getLayout(ctx, module, brandId);
  const { hidden } = applyRules(layout, ruleValues(record, values));
  const out: PresentedField[] = [];
  for (const d of defs) {
    const key = cfKey(d.apiName);
    const access = fieldAccess(ctx, module as ModuleKey, key);
    if (access === "hidden" || hidden.has(key)) continue;
    const v = values[d.apiName] ?? null;
    out.push({ key, apiName: d.apiName, label: d.label, type: d.type, value: access === "masked" && !empty(v) ? "****" : v, masked: access === "masked", brandSpecific: d.brandId !== null });
  }
  return out;
}

/** Filter definitions of a module's custom fields for the list filter panel (key `cf_<apiName>`). */
export async function customFilterFields(ctx: AccessContext, module: CustomModule): Promise<FieldDef[]> {
  const out: FieldDef[] = [];
  for (const d of await definitions(ctx, module)) {
    if (d.type === "FORMULA" || d.type === "MULTI_PICKLIST" || d.type === "LOOKUP" || d.type === "DATE") continue;
    if (fieldAccess(ctx, module as ModuleKey, cfKey(d.apiName)) !== "edit" && fieldAccess(ctx, module as ModuleKey, cfKey(d.apiName)) !== "read") continue; // hidden / masked fields cannot be filtered on
    const type = d.type === "NUMBER" || d.type === "CURRENCY" ? "number" : d.type === "BOOLEAN" ? "boolean" : d.type === "PICKLIST" ? "enum" : "text";
    out.push({ key: cfKey(d.apiName), label: d.label, type, jsonPath: d.apiName, nullable: false, ...(d.type === "PICKLIST" ? { options: d.options.map((o) => ({ value: o, label: o })) } : {}) });
  }
  return out;
}

// ───────────────────────────── administration ─────────────────────────────

function assertAdmin(ctx: AccessContext) {
  if (!ctx.isAdmin) throw new NotFoundError();
}

const fieldSchema = z
  .object({
    module: z.enum(CUSTOM_MODULES),
    apiName: z.string().trim().regex(API_NAME, "start with a lower-case letter; letters and digits only (2–40)"),
    label: z.string().trim().min(1, "Label is required").max(80),
    type: z.enum(FIELD_TYPES),
    options: z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : []), z.array(z.string().trim().min(1).max(80)).max(100)).transform((o) => [...new Set(o)]),
    lookupTarget: z.preprocess((v) => v || null, z.enum(LOOKUP_TARGETS).nullable()),
    formula: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(500).nullable()),
    brandId: z.preprocess((v) => v || null, z.string().max(40).nullable()),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
    position: z.coerce.number().int().min(0).max(999).default(0),
  })
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if ((d.type === "PICKLIST" || d.type === "MULTI_PICKLIST") && d.options.length === 0) issue("A picklist needs at least one option");
    if (d.type === "LOOKUP" && !d.lookupTarget) issue("Choose what the lookup points to");
    if (d.type === "FORMULA") {
      if (!d.formula) issue("Enter the formula");
      else
        try {
          parseFormula(d.formula);
        } catch (e) {
          issue(`Formula: ${e instanceof Error ? e.message : "invalid"}`);
        }
      if (d.required) issue("A formula field cannot be required");
    }
    if (d.brandId && !BRANDED_MODULES.includes(d.module)) issue("Accounts and contacts are shared between brands – their fields cannot be brand-specific");
  });

/** Create / change a custom field. The api name, module and type of an existing field never change. */
export async function saveCustomField(ctx: AccessContext, id: string | null, input: unknown) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const existing = id ? await db.customField.findUnique({ where: { id } }) : null;
  if (id && !existing) throw new NotFoundError();
  const data = fieldSchema.parse(existing ? { ...(input as object), module: existing.module, apiName: existing.apiName, type: existing.type } : input);
  if (!existing && (await db.customField.findFirst({ where: { module: data.module, apiName: data.apiName }, select: { id: true } }))) throw new BadRequestError(`${data.apiName} already exists in this module`);
  const values = { label: data.label, options: data.options, lookupTarget: data.type === "LOOKUP" ? data.lookupTarget : null, formula: data.type === "FORMULA" ? data.formula : null, required: data.required, active: data.active, position: data.position };
  const saved = existing ? await db.customField.update({ where: { id: existing.id }, data: values }) : await db.customField.create({ data: { ...values, module: data.module, apiName: data.apiName, type: data.type, brandId: data.brandId, createdById: ctx.userId } });
  await audit({ ctx, action: existing ? "UPDATE" : "CREATE", entity: "CustomField", entityId: saved.id, brandId: saved.brandId, before: existing ?? undefined, after: saved });
  return { id: saved.id };
}

/** Switches the expression index of a field on or off (filtering / sorting on large modules). */
export async function setCustomFieldIndexed(ctx: AccessContext, id: string, indexed: boolean) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const f = await db.customField.findUnique({ where: { id } });
  if (!f) throw new NotFoundError();
  if (f.type === "FORMULA" || f.type === "MULTI_PICKLIST") throw new BadRequestError("Formula and multi-select fields cannot be indexed");
  if (indexed) await createCustomFieldIndex(f.module, f.apiName);
  else await dropCustomFieldIndex(f.module, f.apiName);
  await db.customField.update({ where: { id }, data: { indexed } });
  await audit({ ctx, action: "UPDATE", entity: "CustomField", entityId: id, after: { indexed } });
}

export async function listLayouts(ctx: AccessContext, module: string) {
  return scopedDb(ctx).layout.findMany({ where: { module }, include: { brand: { select: { code: true } } } });
}

/** Saves the layout of a module (brandId = that brand's variant, null = default). An empty layout removes the variant. */
export async function saveLayout(ctx: AccessContext, module: string, brandId: string | null, input: unknown) {
  assertAdmin(ctx);
  if (!CUSTOM_MODULES.includes(module as CustomModule)) throw new BadRequestError("Unknown module");
  if (brandId && !BRANDED_MODULES.includes(module as CustomModule)) throw new BadRequestError("Shared customer modules have one layout for all brands");
  const definition = layoutSchema.parse(input);
  const db = scopedDb(ctx);
  const existing = await db.layout.findFirst({ where: { module, brandId } });
  const isEmpty = definition.sections.length === 0 && definition.required.length === 0 && definition.rules.length === 0;
  if (existing && isEmpty && brandId) await db.layout.delete({ where: { id: existing.id } });
  else if (existing) await db.layout.update({ where: { id: existing.id }, data: { definition, updatedById: ctx.userId } });
  else if (!isEmpty || !brandId) await db.layout.create({ data: { module, brandId, definition, updatedById: ctx.userId } });
  await audit({ ctx, action: "UPDATE", entity: "Layout", entityId: existing?.id ?? null, brandId, before: existing?.definition, after: definition });
}
