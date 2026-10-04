import { apiHandler } from "@/server/api";
import { parseLeadFilters } from "@/server/modules/leads/schema";
import { exportLeads } from "@/server/modules/leads/service";
import { requireApiContext } from "@/server/request";

/** CSV export of filtered (or `ids=a,b`) leads – profiles with leads.export only (403 otherwise); audited. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const ids = sp.ids ? sp.ids.split(",").filter(Boolean) : undefined;
  const csv = await exportLeads(ctx, parseLeadFilters(sp), ids);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
