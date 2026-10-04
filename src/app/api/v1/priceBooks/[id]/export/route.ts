import { apiHandler } from "@/server/api";
import { exportPriceBook } from "@/server/modules/catalogue/service";
import { requireApiContext } from "@/server/request";

/** CSV export of one price book (priceBooks.export permission; audited). */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { name, csv } = await exportPriceBook(ctx, (await params).id);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}.csv"` },
  });
});
