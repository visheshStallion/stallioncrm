import { brandLetterheadRows } from "@/server/db/print-store";

/**
 * GET /api/public/brands/{id}/logo – the brand's logo for e-mails (mail clients fetch it without a session).
 * A logo is public marketing material; nothing else about the brand is exposed. PNG and JPEG only: an SVG is
 * never served to anonymous clients.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = /^[a-z0-9]{10,40}$/i.test(id) ? (await brandLetterheadRows([id]))[0] : undefined;
  if (!row?.logoData || !row.logoMimeType || !["image/png", "image/jpeg"].includes(row.logoMimeType) || row.status === "INACTIVE") return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(row.logoData), { headers: { "Content-Type": row.logoMimeType, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
