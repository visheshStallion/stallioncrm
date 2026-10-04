import { z } from "zod";
import { MODULE_KEYS } from "./modules";
import { ACTIONS, type FieldPermissionMap, type PermissionMap } from "./types";

const modulePermissionsSchema = z
  .object(Object.fromEntries(ACTIONS.map((a) => [a, z.boolean().optional()])))
  .partial();

/** Parses Profile.permissions JSON. Unknown modules are dropped; malformed input → no permissions. */
export function parsePermissions(json: unknown): PermissionMap {
  if (!json || typeof json !== "object") return {};
  const out: PermissionMap = {};
  for (const key of MODULE_KEYS) {
    const raw = (json as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    const parsed = modulePermissionsSchema.safeParse(raw);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

const fieldAccessSchema = z.enum(["hidden", "masked", "read", "edit"]);

/** Parses Profile.fieldPermissions JSON. Invalid entries are dropped. */
export function parseFieldPermissions(json: unknown): FieldPermissionMap {
  if (!json || typeof json !== "object") return {};
  const out: FieldPermissionMap = {};
  for (const key of MODULE_KEYS) {
    const raw = (json as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") continue;
    const fields: Record<string, z.infer<typeof fieldAccessSchema>> = {};
    for (const [field, level] of Object.entries(raw)) {
      const parsed = fieldAccessSchema.safeParse(level);
      if (parsed.success) fields[field] = parsed.data;
    }
    out[key] = fields;
  }
  return out;
}
