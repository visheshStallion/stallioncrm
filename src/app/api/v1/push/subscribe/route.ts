import { apiHandler } from "@/server/api";
import { pushConfigured, removePushSubscription, savePushSubscription } from "@/server/modules/notifications/service";
import { requireApiContext } from "@/server/request";

/** The VAPID public key (null while web push is not configured). */
export const GET = apiHandler(async () => {
  await requireApiContext();
  return Response.json({ data: { publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null } });
});

/** Stores this browser's push subscription for the signed-in user. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  await savePushSubscription(ctx, (await req.json()) as never, req.headers.get("user-agent"));
  return Response.json({ data: { subscribed: true } }, { status: 201 });
});

export const DELETE = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  await removePushSubscription(ctx, String(((await req.json()) as { endpoint?: string }).endpoint ?? ""));
  return new Response(null, { status: 204 });
});
