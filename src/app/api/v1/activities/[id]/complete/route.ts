import { apiHandler } from "@/server/api";
import { completeActivity } from "@/server/modules/activities/service";
import { requireApiContext } from "@/server/request";

/** POST /api/v1/activities/:id/complete – { outcome?, status?, odometerStart?, odometerEnd?, feedbackRating?, followUpAt? } */
export const POST = apiHandler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiContext();
  const body = await req.json().catch(() => ({}));
  return Response.json({ data: await completeActivity(ctx, (await params).id, body) });
});
