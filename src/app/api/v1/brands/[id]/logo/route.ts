import { NotFoundError } from "@/server/access/errors";
import { apiHandler } from "@/server/api";
import { scopedDb } from "@/server/db";
import { requireApiContext } from "@/server/request";

/** Uploaded brand logo (brands are shared master data: any signed-in user may read it). */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const brand = await scopedDb(ctx).brand.findUnique({ where: { id }, select: { logoData: true, logoMimeType: true } });
  if (!brand?.logoData || !brand.logoMimeType) throw new NotFoundError();
  return new Response(Buffer.from(brand.logoData), {
    headers: {
      "Content-Type": brand.logoMimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // SVG logos must never execute scripts.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
