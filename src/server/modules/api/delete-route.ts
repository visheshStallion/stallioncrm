import "server-only";
import { apiHandler } from "@/server/api";
import { requireApiContext } from "@/server/request";
import { softDelete, type DeletableModule } from "./records";

/** `export const DELETE = deleteHandler("leads")` in a `[id]/route.ts`. */
export function deleteHandler(module: DeletableModule) {
  return apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
    const ctx = await requireApiContext();
    await softDelete(ctx, module, (await params).id);
    return new Response(null, { status: 204 });
  });
}
