import "server-only";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import type { CustomFieldDef, CustomFieldType, CustomModule, CustomValues } from "./engine";

/**
 * Custom-field values posted by `CustomFieldsForm` (inputs named `cf.<apiName>`). Returns undefined when the
 * form carried no custom-field block, so services keep the stored values.
 */
export function customFromForm(fd: FormData): Record<string, unknown> | undefined {
  if (!fd.has("_cfKeys")) return undefined;
  const list = (k: string) => (fd.get(k) ?? "").toString().split(",").filter(Boolean);
  const multi = new Set(list("_cfMulti"));
  const bool = new Set(list("_cfBool"));
  const out: Record<string, unknown> = {};
  for (const key of list("_cfKeys")) {
    const values = fd.getAll(`cf.${key}`).map(String);
    out[key] = multi.has(key) ? values : bool.has(key) ? values.includes("on") : (values[0] ?? "").trim();
  }
  return out;
}

/** Everything `CustomFieldsForm` needs for a module: the caller's visible definitions, layouts and lookups. */
export async function customFormProps(ctx: AccessContext, module: CustomModule) {
  const db = scopedDb(ctx);
  const [fields, layouts] = await Promise.all([db.customField.findMany({ where: { module, active: true } }), db.layout.findMany({ where: { module }, select: { brandId: true, definition: true } })]);
  const defs: CustomFieldDef[] = fields.map((f) => ({ id: f.id, module: f.module, apiName: f.apiName, label: f.label, type: f.type as CustomFieldType, options: f.options, lookupTarget: f.lookupTarget, formula: f.formula, brandId: f.brandId, required: f.required, active: f.active, position: f.position }));
  const needsUsers = defs.some((d) => d.type === "LOOKUP" && d.lookupTarget === "users");
  const needsProducts = defs.some((d) => d.type === "LOOKUP" && d.lookupTarget === "products");
  const [users, products] = await Promise.all([
    needsUsers ? db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    needsProducts ? db.product.findMany({ where: { active: true }, select: { id: true, name: true, brandId: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return { module, defs, layouts, lookups: { users, products } };
}

/** Stored custom values of a record (for edit forms). */
export const storedCustomValues = (record: { customFields?: unknown } | null | undefined): CustomValues => ((record?.customFields && typeof record.customFields === "object" ? record.customFields : {}) as CustomValues);
