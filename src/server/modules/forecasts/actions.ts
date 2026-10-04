"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")));

export async function setTargetAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.setTarget(await requireContext(), obj(fd));
    revalidatePath("/forecasts");
    revalidatePath("/dashboards");
    return { message: "Target saved" };
  });
}

export async function addForecastNoteAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    // The forecast-line picker posts "brandId|regionId|userId".
    const [brandId, regionId, userId] = (fd.get("line") ?? "").toString().split("|");
    await svc.addForecastNote(await requireContext(), { ...obj(fd), ...(brandId ? { brandId, regionId: regionId || null, userId: userId || null } : {}) });
    revalidatePath("/forecasts");
    return { message: "Note added" };
  });
}

export async function deleteForecastNoteAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.deleteForecastNote(await requireContext(), (fd.get("id") ?? "").toString());
    revalidatePath("/forecasts");
    return { message: "Note deleted" };
  });
}
