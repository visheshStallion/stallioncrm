import { apiHandler } from "@/server/api";
import { vinLabelsPdf } from "@/server/modules/inventory/pdf";
import { requireApiContext } from "@/server/request";

/** VIN labels with Code 39 barcodes: GET ?unitId=…&unitId=… (PDF). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const bytes = await vinLabelsPdf(ctx, new URL(req.url).searchParams.getAll("unitId"));
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="vin-labels.pdf"', "Cache-Control": "private, no-store" } });
});
