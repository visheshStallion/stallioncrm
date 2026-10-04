"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import { NOTIFICATION_KINDS } from "./preferences";
import { markAllRead, markRead, saveNotificationPrefs } from "./service";

export async function markNotificationsReadAction() {
  return safeAction(async () => {
    await markAllRead(await requireContext());
    revalidatePath("/", "layout");
    return { message: "Notifications marked as read" };
  });
}

export async function markNotificationReadAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ message?: string }>> {
  return safeAction(async () => {
    await markRead(await requireContext(), String(fd.get("id") ?? ""));
    revalidatePath("/", "layout");
    return {};
  });
}

/** Preferences form: checkboxes `<KIND>:<channel>`, quiet hours, digest. */
export async function saveNotificationPrefsAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ message?: string }>> {
  return safeAction(async () => {
    const kinds = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, { inApp: fd.get(`${k}:inApp`) === "on", email: fd.get(`${k}:email`) === "on", push: fd.get(`${k}:push`) === "on" }]));
    const t = (k: string) => String(fd.get(k) ?? "").trim() || null;
    await saveNotificationPrefs(await requireContext(), { kinds, quietFrom: t("quietFrom"), quietTo: t("quietTo"), digest: fd.get("digest") === "on" });
    revalidatePath("/notifications");
    return { message: "Notification preferences saved" };
  });
}
