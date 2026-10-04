"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import * as admin from "./admin";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$") && !k.startsWith("_")).map(([k, v]) => [k, (v as string).trim()]));

export async function createCaseAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const c = await svc.createCase(await requireContext(), obj(fd) as never);
    revalidatePath("/cases");
    return { message: `Case ${c.number} created`, redirect: `/cases/${c.id}` };
  });
}

export async function updateCaseAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const { id, ...rest } = obj(fd);
    await svc.updateCase(await requireContext(), String(id), rest as never);
    revalidatePath(`/cases/${id}`);
    return { message: "Case updated" };
  });
}

export async function changeCaseStatusAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await svc.changeCaseStatus(await requireContext(), str(fd, "id"), { status: str(fd, "status"), resolution: str(fd, "resolution") });
    revalidatePath("/", "layout");
    return { message: res.status === "CLOSED" ? (res.survey ? "Case closed – satisfaction survey sent" : "Case closed (no survey: the customer has no email or mobile, or the brand has no sender)") : `Status: ${svc.STATUS_LABELS[res.status as keyof typeof svc.STATUS_LABELS]}` };
  });
}

export async function assignCaseAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.assignCase(await requireContext(), str(fd, "id"), str(fd, "ownerId") || null);
    revalidatePath("/", "layout");
    return { message: str(fd, "ownerId") ? "Case reassigned" : "The case is yours" };
  });
}

export async function createCaseFromActivityAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const c = await svc.createCaseFromActivity(await requireContext(), str(fd, "activityId"), { type: str(fd, "type") || undefined });
    revalidatePath("/cases");
    return { message: `Case ${c.number} created`, redirect: `/cases/${c.id}` };
  });
}

// ── configuration ──
export async function saveSlaAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await admin.saveSlaPolicy(await requireContext(), str(fd, "brandId"), str(fd, "priority"), { firstResponseHours: str(fd, "firstResponseHours"), resolutionHours: str(fd, "resolutionHours"), escalateToRole: str(fd, "escalateToRole") || "Brand Manager" });
    revalidatePath("/cases/sla");
    return { message: "SLA policy saved" };
  });
}

export async function saveBusinessHoursAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await admin.saveBusinessHours(await requireContext(), { workDays: fd.getAll("workDays").map(String), opensAt: str(fd, "opensAt"), closesAt: str(fd, "closesAt") });
    revalidatePath("/cases/sla");
    return { message: "Business hours saved" };
  });
}

export async function addHolidayAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await admin.addHoliday(await requireContext(), { date: str(fd, "date"), name: str(fd, "name") });
    revalidatePath("/cases/sla");
    return { message: "Holiday added" };
  });
}

export async function removeHolidayAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await admin.removeHoliday(await requireContext(), str(fd, "date"));
    revalidatePath("/cases/sla");
    return { message: "Holiday removed" };
  });
}

export async function saveSolutionAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const saved = await admin.saveSolution(await requireContext(), str(fd, "id") || null, { brandId: str(fd, "brandId") || null, title: str(fd, "title"), body: str(fd, "body"), tags: str(fd, "tags"), published: fd.get("published") === "on" });
    revalidatePath("/cases/solutions");
    return { message: "Article saved", redirect: `/cases/solutions?id=${saved.id}` };
  });
}

export async function deleteSolutionAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await admin.deleteSolution(await requireContext(), str(fd, "id"));
    revalidatePath("/cases/solutions");
    return { message: "Article deleted", redirect: "/cases/solutions" };
  });
}
