import { apiHandler } from "@/server/api";
import { reconcilePayment } from "@/server/integrations/erp";
import { checkWebhookToken, denied } from "@/server/webhook-auth";

/**
 * Payment status from the ERP (reconciliation): `{ externalId, companyCode, amount, reference, receivedAt?, system? }`.
 * Authenticated with ERP_WEBHOOK_SECRET (Bearer or ?token=); 404 while the secret is not configured.
 */
export const POST = apiHandler(async (req) => {
  const state = checkWebhookToken(req, process.env.ERP_WEBHOOK_SECRET);
  if (state !== "ok") return denied(state);
  return Response.json({ data: await reconcilePayment((await req.json()) as Record<string, never>) });
});
