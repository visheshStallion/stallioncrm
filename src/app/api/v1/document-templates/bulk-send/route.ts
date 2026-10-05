import { z } from "zod";
import { apiHandler } from "@/server/api";
import { requestBulkSend } from "@/server/modules/doctpl/bulk";
import { requireApiContext } from "@/server/request";

const schema = z.object({ module: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(100), documentTemplate: z.string().max(80).default("default"), emailTemplateId: z.string().max(40).nullish() });

/**
 * POST /api/v1/document-templates/bulk-send – the selected quotations, sales orders, invoices or deals, each as a PDF
 * with the chosen document template, one e-mail per record to its own customer (background job; report under
 * Exports). Needs the mass e-mail permission; a record the caller cannot open fails the request with 404.
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const input = schema.parse(await req.json());
  return Response.json({ data: await requestBulkSend(ctx, input) }, { status: 202 });
});
