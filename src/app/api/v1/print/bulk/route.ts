import { z } from "zod";
import { apiHandler } from "@/server/api";
import { requestBulkPrint } from "@/server/modules/print/bulk";
import { requireApiContext } from "@/server/request";

const schema = z.object({ module: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(500), templateId: z.string().nullish(), format: z.enum(["pdf", "zip"]).default("pdf") });

/**
 * POST /api/v1/print/bulk { module, ids, templateId?, format: "pdf" | "zip" }
 * Queues a print job for the selected records (at most 500): one merged PDF or a ZIP of separate PDFs, ready on the
 * Exports page for 24 hours. 404 when any id is not visible to the caller.
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const input = schema.parse(await req.json());
  const job = await requestBulkPrint(ctx, { module: input.module, ids: input.ids, templateId: input.templateId ?? null, format: input.format });
  return Response.json({ data: job }, { status: 202 });
});
