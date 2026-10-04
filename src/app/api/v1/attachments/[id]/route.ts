import { apiHandler } from "@/server/api";
import { readAttachment } from "@/server/modules/notes/service";
import { requireApiContext } from "@/server/request";

/** Brand-scoped download: 404 when the attachment belongs to a record the caller cannot see. */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const file = await readAttachment(ctx, (await params).id);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
