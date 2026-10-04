"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import * as notes from "@/server/modules/notes/service";
import { requireContext } from "@/server/request";
import { DEAL_FIELD_KEYS, type UpdateDealInput } from "./schema";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
/** Only fields present in the form are sent (partial update). */
const fields = (fd: FormData) => Object.fromEntries(DEAL_FIELD_KEYS.filter((k) => fd.has(k)).map((k) => [k, str(fd, k)]));

export async function createDealFormAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const deal = await svc.createDeal(ctx, { ...fields(fd), brandId: str(fd, "brandId"), regionId: str(fd, "regionId"), pipelineId: str(fd, "pipelineId") } as never);
    revalidatePath("/deals");
    return { message: "Deal created successfully", redirect: fd.get("_saveAndNew") ? "/deals/new" : `/deals/${deal.id}` };
  });
}

export async function updateDealFormAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.updateDeal(ctx, id, { ...fields(fd), ...(fd.has("regionId") ? { regionId: str(fd, "regionId") } : {}) } as never);
    revalidatePath(`/deals/${id}`);
    return { message: "Deal updated successfully", redirect: `/deals/${id}` };
  });
}

/** Blueprint move (kanban drag, stage bar, dialog). `values` = requirement fields entered in the dialog. */
export async function moveDealStageAction(id: string, toStageId: string, values: Record<string, string> = {}) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await svc.moveDealStage(ctx, id, toStageId, values as UpdateDealInput);
    revalidatePath("/deals");
    revalidatePath(`/deals/${id}`);
    return res;
  });
}

export async function changeDealOwnerAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.changeDealOwner(ctx, id, str(fd, "ownerId"));
    revalidatePath(`/deals/${id}`);
    return { message: "Owner changed" };
  });
}

// ── notes & attachments ──
export async function addNoteAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    await notes.addNote(ctx, str(fd, "entity"), str(fd, "entityId"), str(fd, "body"));
    revalidatePath(str(fd, "path") || "/deals");
    return { message: "Note added" };
  });
}

export async function deleteNoteAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await notes.deleteNote(await requireContext(), str(fd, "id"));
    revalidatePath(str(fd, "path") || "/deals");
    return { message: "Note deleted" };
  });
}

export async function uploadAttachmentAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BadRequestError("Choose a file");
    await notes.addAttachment(ctx, str(fd, "entity"), str(fd, "entityId"), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidatePath(str(fd, "path") || "/deals");
    return { message: "File attached" };
  });
}

export async function deleteAttachmentAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await notes.deleteAttachment(await requireContext(), str(fd, "id"));
    revalidatePath(str(fd, "path") || "/deals");
    return { message: "Attachment removed" };
  });
}

// ── pipeline setup (administrators) ──
export async function updateStageAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const max = str(fd, "maxDaysInStage");
    await svc.updatePipelineStage(ctx, str(fd, "stageId"), {
      name: str(fd, "name"),
      probability: Number(str(fd, "probability")),
      maxDaysInStage: max ? Number(max) : null,
      requiredFields: fd.getAll("requiredFields").map(String),
      allowedTransitions: fd.get("customTransitions") === "on" ? fd.getAll("allowedTransitions").map(String) : null,
    });
    revalidatePath("/admin/pipelines");
    return { message: "Stage saved" };
  });
}

export async function addStageAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.addPipelineStage(await requireContext(), str(fd, "pipelineId"), str(fd, "name"));
    revalidatePath("/admin/pipelines");
    return { message: "Stage added" };
  });
}

export async function deleteStageAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.deletePipelineStage(await requireContext(), str(fd, "stageId"));
    revalidatePath("/admin/pipelines");
    return { message: "Stage removed" };
  });
}
