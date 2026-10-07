import { NotFoundError } from "@/server/access/errors";
import { hasPermission } from "@/server/access/can";
import { apiHandler } from "@/server/api";
import { scopedDb } from "@/server/db";
import { requireApiContext } from "@/server/request";

/** Vendor Image (PNG / JPEG / WebP, uploaded on the vendor page) – users of the vendor's brand with inventory access. */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  if (!hasPermission(ctx, "inventory", "read")) throw new NotFoundError();
  const { id } = await params;
  const v = await scopedDb(ctx).vendor.findUnique({ where: { id }, select: { imageData: true, imageMimeType: true } });
  if (!v?.imageData || !v.imageMimeType) throw new NotFoundError();
  return new Response(Buffer.from(v.imageData), { headers: { "Content-Type": v.imageMimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
});
