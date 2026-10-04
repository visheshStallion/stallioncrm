import { apiHandler } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { fullBackup } from "@/server/modules/exports/service";
import { requireApiContext } from "@/server/request";

/**
 * Full encrypted backup (all brands) – administrators only (404 otherwise). The passphrase comes in the POST
 * body, never in the URL; it is not stored. Decrypt with `pnpm backup:decrypt`.
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const type = req.headers.get("content-type") ?? "";
  const passphrase = type.includes("json") ? String(((await req.json()) as { passphrase?: unknown }).passphrase ?? "") : String((await req.formData()).get("passphrase") ?? "");
  if (!passphrase) throw new BadRequestError("Enter a passphrase");
  const file = await fullBackup(ctx, passphrase);
  return new Response(file.body as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" } });
});
