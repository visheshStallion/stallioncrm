import { apiHandler } from "@/server/api";
import { previewTemplatePdf } from "@/server/modules/doctpl/service";
import { requireApiContext } from "@/server/request";

/**
 * POST /api/v1/document-templates/preview-pdf – the template builder's "Download test PDF": the working copy rendered
 * for a record the user can open, watermarked PREVIEW. Nothing is saved and no document is stored.
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const bytes = await previewTemplatePdf(ctx, await req.json());
  return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="template-test.pdf"', "Cache-Control": "no-store" } });
});
