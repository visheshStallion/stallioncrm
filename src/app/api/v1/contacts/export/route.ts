import { apiHandler } from "@/server/api";
import { exportContacts } from "@/server/modules/customers/service";
import { requireApiContext } from "@/server/request";

/** CSV export – contacts.export permission (403 otherwise); rows masked per tier; audited. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const csv = await exportContacts(ctx, new URL(req.url).searchParams.get("q") ?? undefined);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});
