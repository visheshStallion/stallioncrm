import { toCsv } from "@/lib/csv";
import { apiHandler } from "@/server/api";
import { accessReview } from "@/server/modules/security/service";
import { requireApiContext } from "@/server/request";

/** Access review as CSV – administrators only (404 otherwise); audited. */
export const GET = apiHandler(async () => {
  const ctx = await requireApiContext();
  const rows = await accessReview(ctx);
  const csv = toCsv(["name", "email", "type", "active", "role", "profile", "brands", "regions", "territories", "manager of", "last sign-in", "days since", "two-step", "locked", "flags"], rows.map((r) => [r.name, r.email, r.kind, r.active ? "yes" : "no", r.role, r.profile, r.brands.join(" "), r.regions.join(" | "), r.territories.join(" | "), r.managerOf.join(" | "), r.lastLoginAt?.slice(0, 10) ?? "", r.daysSinceLogin ?? "", r.twoStep ? "yes" : "no", r.locked ? "yes" : "no", r.flags.join("; ")]));
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="access-review-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
