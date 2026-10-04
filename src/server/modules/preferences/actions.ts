"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import { setPreference } from "./queries";

/** Saves one UI preference (theme, density, dateFormat, rail, columns:<module>) for the current user. */
export async function setPreferenceAction(key: string, value: unknown) {
  return safeAction(async () => {
    await setPreference(await requireContext(), key, value);
    if (!key.startsWith("columns:")) revalidatePath("/", "layout");
    return { message: "Preference saved" };
  });
}
