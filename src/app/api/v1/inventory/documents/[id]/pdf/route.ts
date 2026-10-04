import { apiHandler } from "@/server/api";
import { purchaseOrderPdf } from "@/server/modules/inventory/pdf";
import { requireApiContext } from "@/server/request";

/** Purchase order as PDF on the brand's legal entity. */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { bytes, number } = await purchaseOrderPdf(ctx, (await params).id);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${number}.pdf"`, "Cache-Control": "private, no-store" } });
});
