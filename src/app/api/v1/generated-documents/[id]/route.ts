import { apiHandler } from "@/server/api";
import { generatedFile } from "@/server/modules/doctpl/service";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/generated-documents/{id} – the stored copy of a document exactly as it was sent or downloaded.
 * 404 unless the user can open the record the copy belongs to.
 */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const file = await generatedFile(ctx, (await params).id);
  return new Response(file.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.fileName}"`, "Cache-Control": "no-store" } });
});
