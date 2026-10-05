/**
 * Configuration as code (prompt 19 §3.3): the configuration as one versioned JSON document – export, validate,
 * import. Brands, territories, users and business data are NOT part of it: a configuration refers to brands by their
 * code and can therefore be moved between two installations that have the same brands.
 *
 * Covered: organisation settings, roles, profiles (permissions, field access, setup permissions), validation rules,
 * custom fields, layouts, pipelines with their stages. Not covered yet: workflow rules, approval processes,
 * assignment rules, templates (docs/SETUP_CATALOGUE.md).
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import * as store from "@/server/db/setup-store";
import { BadRequestError } from "@/server/errors";
import { z } from "zod";
import { assertSetup } from "./access";
import { SETUP_CATALOGUE } from "./catalogue";
import { ExpressionError, parseExpression } from "./expression";
import { ruleFields } from "./service";
import { SETTINGS, isSettingKey, resolveSetting } from "./settings";

export const CONFIG_VERSION = 1;

const json = z.unknown();
const stage = z.object({ key: z.string().min(1), name: z.string().min(1), order: z.number().int(), probability: z.number().int().min(0).max(100), type: z.enum(["OPEN", "WON", "LOST"]), requiredFields: json, allowedTransitions: json, maxDaysInStage: z.number().int().nullable() });

export const configurationSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  settings: z.record(json),
  roles: z.array(z.object({ name: z.string().min(1), parent: z.string().nullable() })),
  profiles: z.array(z.object({ name: z.string().min(1), scope: z.enum(["ALL", "TERRITORY"]), permissions: z.record(json), fieldPermissions: z.record(json), setupSections: z.array(z.string()) })),
  validationRules: z.array(z.object({ module: z.string(), brand: z.string().nullable(), name: z.string().min(1), expression: z.string().min(1), message: z.string().min(1), active: z.boolean() })),
  customFields: z.array(z.object({ module: z.string(), apiName: z.string().min(1), label: z.string().min(1), type: z.string().min(1), options: z.array(z.string()), lookupTarget: z.string().nullable(), formula: z.string().nullable(), brand: z.string().nullable(), required: z.boolean(), active: z.boolean(), position: z.number().int() })),
  layouts: z.array(z.object({ module: z.string(), brand: z.string().nullable(), definition: json })),
  pipelines: z.array(z.object({ brand: z.string().min(1), name: z.string().min(1), isDefault: z.boolean(), stages: z.array(stage).min(1) })),
});
export type Configuration = z.infer<typeof configurationSchema>;

/** The current configuration. Deterministic: sorted, without ids or timestamps – two exports of the same configuration are identical. */
export async function exportConfiguration(ctx: AccessContext): Promise<Configuration> {
  assertSetup(ctx, "config-as-code");
  const config = await buildConfiguration();
  await audit({ ctx, action: "EXPORT", entity: "Configuration", after: { version: CONFIG_VERSION, counts: counts(config) } });
  return config;
}

export async function buildConfiguration(): Promise<Configuration> {
  const rows = await store.readConfiguration();
  const brandCode = new Map(rows.brands.map((b) => [b.id, b.code]));
  const roleName = new Map(rows.roles.map((r) => [r.id, r.name]));
  const code = (id: string | null) => (id ? (brandCode.get(id) ?? null) : null);
  return {
    version: CONFIG_VERSION,
    settings: Object.fromEntries(rows.settings.map((s) => [s.key, s.value])),
    roles: rows.roles.map((r) => ({ name: r.name, parent: r.parentRoleId ? (roleName.get(r.parentRoleId) ?? null) : null })),
    profiles: rows.profiles.map((p) => ({ name: p.name, scope: p.scope, permissions: p.permissions as Record<string, unknown>, fieldPermissions: p.fieldPermissions as Record<string, unknown>, setupSections: Array.isArray(p.setupSections) ? (p.setupSections as string[]) : [] })),
    validationRules: rows.validationRules.map(({ brandId, ...r }) => ({ ...r, brand: code(brandId) })).sort((a, b) => `${a.module}|${a.name}|${a.brand}`.localeCompare(`${b.module}|${b.name}|${b.brand}`)),
    customFields: rows.customFields.map(({ brandId, ...f }) => ({ ...f, brand: code(brandId) })),
    layouts: rows.layouts.map(({ brandId, ...l }) => ({ ...l, brand: code(brandId) })).sort((a, b) => `${a.module}|${a.brand}`.localeCompare(`${b.module}|${b.brand}`)),
    pipelines: rows.pipelines.map(({ brandId, ...p }) => ({ ...p, brand: brandCode.get(brandId) ?? "?" })).sort((a, b) => `${a.brand}|${a.name}`.localeCompare(`${b.brand}|${b.name}`)),
  };
}

const counts = (c: Configuration) => ({ settings: Object.keys(c.settings).length, roles: c.roles.length, profiles: c.profiles.length, validationRules: c.validationRules.length, customFields: c.customFields.length, layouts: c.layouts.length, pipelines: c.pipelines.length });

/**
 * Checks a configuration against this installation WITHOUT changing anything: structure, setting values, brand codes,
 * role parents, formulas and delegable setup permissions. Returns the problems (empty = it can be imported).
 */
export async function validateConfiguration(raw: unknown): Promise<{ config: Configuration | null; problems: string[] }> {
  const parsed = configurationSchema.safeParse(raw);
  if (!parsed.success) return { config: null, problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "document"}: ${i.message}`) };
  const config = parsed.data;
  const problems: string[] = [];
  const rows = await store.readConfiguration();
  const brands = new Set(rows.brands.map((b) => b.code));
  const needBrand = (code: string | null, where: string) => {
    if (code && !brands.has(code)) problems.push(`${where}: brand ${code} does not exist here`);
  };

  for (const [key, value] of Object.entries(config.settings)) {
    if (!isSettingKey(key)) problems.push(`settings.${key}: unknown setting`);
    else {
      const r = (SETTINGS[key].schema as z.ZodTypeAny).safeParse(value);
      if (!r.success) problems.push(`settings.${key}: ${r.error.issues[0]?.message ?? "invalid"}`);
    }
  }
  const roleNames = new Set(config.roles.map((r) => r.name));
  for (const r of config.roles) if (r.parent && !roleNames.has(r.parent)) problems.push(`roles.${r.name}: parent ${r.parent} is not in the document`);
  const delegable = new Set(SETUP_CATALOGUE.filter((e) => e.delegable).map((e) => e.key));
  for (const p of config.profiles) for (const s of p.setupSections) if (!delegable.has(s)) problems.push(`profiles.${p.name}: "${s}" is not a setup permission that can be delegated`);
  if (!config.profiles.some((p) => (p.permissions as { admin?: { edit?: boolean } }).admin?.edit === true)) problems.push("profiles: no profile has the Administrator permission – importing this would lock everyone out of Setup");
  for (const v of config.validationRules) {
    needBrand(v.brand, `validationRules.${v.name}`);
    try {
      parseExpression(v.expression, ruleFields(v.module));
    } catch (e) {
      problems.push(`validationRules.${v.name}: ${e instanceof ExpressionError || e instanceof BadRequestError ? e.message : "invalid formula"}`);
    }
  }
  for (const f of config.customFields) needBrand(f.brand, `customFields.${f.module}.${f.apiName}`);
  for (const l of config.layouts) needBrand(l.brand, `layouts.${l.module}`);
  for (const p of config.pipelines) {
    if (!brands.has(p.brand)) problems.push(`pipelines.${p.name}: brand ${p.brand} does not exist here`);
    if (new Set(p.stages.map((s) => s.key)).size !== p.stages.length) problems.push(`pipelines.${p.brand}.${p.name}: duplicate stage key`);
  }
  return { config, problems };
}

/** Validates, then applies the whole document in one transaction (all or nothing). */
export async function importConfiguration(ctx: AccessContext, raw: unknown): Promise<Record<string, number>> {
  assertSetup(ctx, "config-as-code");
  const { config, problems } = await validateConfiguration(raw);
  if (!config || problems.length) throw new BadRequestError(`The configuration was not imported: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` … and ${problems.length - 5} more` : ""}`);
  const rows = await store.readConfiguration();
  const brandId = new Map(rows.brands.map((b) => [b.code, b.id]));
  const id = (code: string | null) => (code ? (brandId.get(code) ?? null) : null);
  const before = await buildConfiguration();
  // An import is one person's action: it must not be a way around the four-eyes rule for authentication policies.
  for (const key of Object.keys(SETTINGS).filter(isSettingKey)) {
    if (!SETTINGS[key].fourEyes) continue;
    const now = JSON.stringify(resolveSetting(key, before.settings[key]));
    const then = JSON.stringify(resolveSetting(key, config.settings[key]));
    if (now !== then) throw new BadRequestError(`The configuration was not imported: it would change "${SETTINGS[key].title}". Authentication policies need a second Super Admin – change it under Security Control first, then import.`);
  }
  const applied = await store.applyConfiguration(
    {
      settings: Object.entries(config.settings).map(([key, value]) => ({ key, value })),
      roles: config.roles,
      profiles: config.profiles,
      validationRules: config.validationRules.map(({ brand, ...v }) => ({ ...v, brandId: id(brand) })),
      customFields: config.customFields.map(({ brand, ...f }) => ({ ...f, brandId: id(brand) })),
      layouts: config.layouts.map(({ brand, ...l }) => ({ ...l, brandId: id(brand) })),
      pipelines: config.pipelines.map(({ brand, ...p }) => ({ ...p, brandId: brandId.get(brand)! })),
    },
    ctx.userId,
  );
  store.clearSetupCaches();
  await audit({ ctx, action: "IMPORT", entity: "Configuration", before: { counts: counts(before) }, after: { version: config.version, applied } });
  return applied;
}
