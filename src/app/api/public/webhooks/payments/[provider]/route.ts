import { handlePaymentWebhook } from "@/server/integrations/payments";
import { rateLimit } from "@/server/rate-limit";

/**
 * Paystack / Flutterwave webhook. The signature is verified with the merchant key of the brand the payment
 * reference belongs to; a verified successful charge is booked on the invoice exactly once.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`paywebhook:${ip}`, 120, 60_000).ok) return Response.json({ error: "rate limited" }, { status: 429 });
  const { status, result } = await handlePaymentWebhook((await params).provider, await req.text(), req.headers);
  return Response.json({ result }, { status });
}
