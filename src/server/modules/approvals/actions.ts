"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { updateApprovalProcess } from "@/server/db/approval-engine";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

/** Approve / reject from the inbox or the record page (the submit button carries `decision`). */
export async function decideApprovalFormAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const approve = str(fd, "decision") !== "reject";
    const out = await svc.decide(ctx, str(fd, "requestId"), approve, str(fd, "note"));
    revalidatePath("/", "layout");
    return { message: !approve ? "Rejected" : out.status === "PENDING" ? "Approved – waiting for the other approvers" : "Approved" };
  });
}

export async function recallApprovalAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.recall(await requireContext(), str(fd, "requestId"));
    revalidatePath("/", "layout");
    return { message: "Request recalled" };
  });
}

const sent = (o: { status: string }, what: string) => (o.status === "APPROVED" ? `${what} applied` : `${what} sent for approval – the record is locked until it is decided`);

export async function requestBrandChangeAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const out = await svc.requestBrandChange(ctx, str(fd, "entity"), str(fd, "id"), { newBrandId: str(fd, "newBrandId"), newOwnerId: str(fd, "newOwnerId") || null, reason: str(fd, "reason") });
    revalidatePath("/", "layout");
    return { message: sent(out, "Brand change") };
  });
}

export async function requestOwnerTransferAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const out = await svc.requestOwnerTransfer(ctx, str(fd, "entity"), str(fd, "id"), { newRegionId: str(fd, "newRegionId"), newOwnerId: str(fd, "newOwnerId"), reason: str(fd, "reason") });
    revalidatePath("/", "layout");
    return { message: sent(out, "Transfer") };
  });
}

/** Administrator: switch a process on / off, set the auto-approve hours of its steps (`auto:<stepId>` fields). */
export async function updateApprovalProcessAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const hours: Record<string, number | null> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("auto:")) hours[k.slice(5)] = v.toString().trim() ? Number(v) : null;
    await updateApprovalProcess(ctx, str(fd, "id"), { active: fd.get("active") === "on", autoApproveAfterHours: hours });
    revalidatePath("/admin/approval-processes");
    return { message: "Approval process saved" };
  });
}
