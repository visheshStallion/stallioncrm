"use server";

import { revalidatePath } from "next/cache";
import { fromLocalInput } from "@/lib/format";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const WHEN = ["dueAt", "startAt", "endAt", "reminderAt", "followUpAt"];
/** Form values; datetime-local fields are Lagos wall-clock times. */
const obj = (fd: FormData) => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !k.startsWith("_")) o[k] = WHEN.includes(k) ? fromLocalInput(v.trim()) : v.trim();
  return o;
};
const PARENT_PATH: Record<string, string> = { Lead: "/leads", Deal: "/deals", Account: "/accounts", Case: "/cases" };

export async function createActivityAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    // "Related to" picker of the standalone form posts "Deal:<id>" / "Lead:<id>".
    const [pickedType, pickedId] = str(fd, "_parent").split(":");
    const input = { ...obj(fd), ...(pickedId ? { parentType: pickedType, parentId: pickedId } : {}), participants: fd.getAll("participants").map(String) };
    await svc.createActivity(ctx, input as never);
    const parent = `${PARENT_PATH[str(fd, "parentType")] ?? "/activities"}/${str(fd, "parentId")}`;
    revalidatePath("/", "layout");
    return { message: str(fd, "completed") ? "Activity logged" : "Activity created", redirect: str(fd, "_back") === "parent" ? parent : "/activities" };
  });
}

export async function completeActivityAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await svc.completeActivity(ctx, str(fd, "id"), obj(fd) as never);
    revalidatePath("/", "layout");
    const status = str(fd, "status") || "COMPLETED";
    return {
      message: status !== "COMPLETED" ? "Activity closed" : res.dealAdvanced ? "Completed – the deal moved to Test Drive" : res.nextId ? "Completed – next occurrence created" : "Activity completed",
    };
  });
}

export async function rescheduleActivityAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const o = obj(fd) as Record<string, string>;
    await svc.updateActivity(ctx, str(fd, "id"), {
      ...(fd.has("subject") ? { subject: o.subject } : {}),
      ...(fd.has("dueAt") ? { dueAt: o.dueAt || null } : {}),
      ...(fd.has("startAt") ? { startAt: o.startAt || null } : {}),
      ...(fd.has("endAt") ? { endAt: o.endAt || null } : {}),
      ...(fd.has("reminderAt") ? { reminderAt: o.reminderAt || null } : {}),
    });
    revalidatePath("/", "layout");
    return { message: "Activity updated" };
  });
}
