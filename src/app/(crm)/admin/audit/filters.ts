import type { AuditQuery } from "@/server/db/system";

/** URL search params → audit query (dates are inclusive whole days, UTC). */
export function parseAuditFilters(sp: Record<string, string | null | undefined>): AuditQuery {
  const date = (v: string | null | undefined, endOfDay = false) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    return new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  };
  return {
    userId: sp.userId || undefined,
    entity: sp.entity || undefined,
    brandId: sp.brandId || undefined,
    from: date(sp.from),
    to: date(sp.to, true),
  };
}
