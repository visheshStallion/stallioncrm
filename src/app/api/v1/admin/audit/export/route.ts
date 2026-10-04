import { parseAuditFilters } from "@/app/(crm)/admin/audit/filters";
import { toCsv } from "@/lib/csv";
import { apiHandler } from "@/server/api";
import { audit } from "@/server/db";
import { auditLog } from "@/server/modules/admin/queries";
import { requireApiContext } from "@/server/request";

/** CSV export of the (filtered) audit log – administrators only (404 otherwise); the export is itself audited. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const filters = parseAuditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const { rows, total } = await auditLog(ctx, { ...filters, take: 50_000 });
  await audit({ ctx, action: "EXPORT", entity: "AuditLog", after: { filters, rows: rows.length, total } });
  const csv = toCsv(
    ["at", "user", "email", "action", "entity", "entityId", "brandId", "ip", "before", "after"],
    rows.map((r) => [r.at, r.user?.name, r.user?.email, r.action, r.entity, r.entityId, r.brandId, r.ip, r.before, r.after]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
