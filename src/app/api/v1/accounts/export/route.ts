import { apiHandler } from "@/server/api";
import { exportAccounts } from "@/server/modules/customers/service";
import { requireApiContext } from "@/server/request";

/** CSV export – accounts.export permission (403 otherwise); rows masked per tier; audited. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const csv = await exportAccounts(ctx, new URL(req.url).searchParams.get("q") ?? undefined);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});
