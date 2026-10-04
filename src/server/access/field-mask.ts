import type { ModuleKey } from "./modules";
import type { AccessContext, FieldAccess } from "./types";

/** Field level for a module/field. Unconfigured fields are editable. */
export function fieldAccess(ctx: AccessContext, module: ModuleKey, field: string): FieldAccess {
  return ctx.profile.fieldPermissions[module]?.[field] ?? "edit";
}

/** `08031234521` → `0803****21` */
export function maskPhone(value: string): string {
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 6) return "****";
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

/** `ada.okafor@example.com` → `a***@example.com` */
export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "****";
  return `${local[0]}***@${domain}`;
}

export function maskValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  const str = String(value);
  if (/phone|mobile|whatsapp/i.test(field)) return maskPhone(str);
  if (/email/i.test(field)) return maskEmail(str);
  return "****";
}

/**
 * Applies field-level permissions to a record (shallow): hidden fields are removed, masked fields
 * are partially obscured. Returns a new object; the input is not mutated.
 */
export function fieldMask<T extends object>(
  ctx: AccessContext,
  module: ModuleKey,
  record: T,
): Partial<T> {
  const rules = ctx.profile.fieldPermissions[module];
  if (!rules) return { ...record };
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const [field, level] of Object.entries(rules)) {
    if (!(field in out)) continue;
    if (level === "hidden") delete out[field];
    else if (level === "masked") out[field] = maskValue(field, out[field]);
  }
  return out as Partial<T>;
}

export function fieldMaskMany<T extends object>(
  ctx: AccessContext,
  module: ModuleKey,
  records: T[],
): Partial<T>[] {
  return records.map((r) => fieldMask(ctx, module, r));
}

/**
 * The same masking for screens: the record keeps its shape (hidden fields become null, so pages render "—")
 * instead of losing keys. Use `fieldMask` for API and export payloads, this for server-rendered pages.
 */
export function fieldMaskView<T extends object>(ctx: AccessContext, module: ModuleKey, record: T): T {
  const rules = ctx.profile.fieldPermissions[module];
  if (!rules) return record;
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const [field, level] of Object.entries(rules)) {
    if (!(field in out)) continue;
    if (level === "hidden") out[field] = null;
    else if (level === "masked") out[field] = maskValue(field, out[field]);
  }
  return out as T;
}

/**
 * Write side of field-level security: fields the profile may not edit (hidden, masked or read-only) are
 * dropped from an update, so a crafted request – or a form that received a masked value – cannot change them.
 */
export function stripUneditable<T extends object>(ctx: AccessContext, module: ModuleKey, input: T): T {
  const rules = ctx.profile.fieldPermissions[module];
  if (!rules) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [field, level] of Object.entries(rules)) if (level !== "edit") delete out[field];
  return out as T;
}
