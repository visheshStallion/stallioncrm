/**
 * Integration settings come from the environment only (never from the database or the repository).
 * Every setting can be given per brand – the brands are separate legal entities with their own ERP company
 * and their own payment accounts – with a group-wide fallback:
 *   ERP_ADAPTER_HMNL=business-central   overrides   ERP_ADAPTER=csv   for brand HMNL.
 * An unset setting switches the feature off (feature flag).
 */
import "server-only";

export function brandEnv(name: string, brandCode: string): string | undefined {
  const suffix = brandCode.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[`${name}_${suffix}`]?.trim() || process.env[name]?.trim() || undefined;
}
