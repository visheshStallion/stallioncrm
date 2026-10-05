import { z } from "zod";
import { apiHandler } from "@/server/api";
import { previewLayout } from "@/server/modules/print/service";
import { requireApiContext } from "@/server/request";

const schema = z.object({ module: z.string().min(1), layout: z.unknown(), brandId: z.string().nullable(), paper: z.enum(["A4", "LETTER"]), orientation: z.enum(["portrait", "landscape"]), recordId: z.string().nullish() });

/**
 * POST /api/v1/print/preview – the template designer's live preview: the layout being edited, rendered with a sample
 * record the designer can open. Nothing is saved. Setup tier of "print-templates" (404 otherwise).
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const input = schema.parse(await req.json());
  const html = await previewLayout(ctx, { module: input.module, layout: input.layout, brandId: input.brandId, paper: input.paper, orientation: input.orientation, recordId: input.recordId ?? null });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
