"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import { markAllRead } from "./service";

export async function markNotificationsReadAction() {
  return safeAction(async () => {
    await markAllRead(await requireContext());
    revalidatePath("/", "layout");
    return { message: "Notifications marked as read" };
  });
}
