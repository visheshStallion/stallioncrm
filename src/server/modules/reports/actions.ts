"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

/** The report builder posts the whole report (name, folder, definition) as JSON in `payload`. */
export async function saveReportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    let payload: unknown;
    try {
      payload = JSON.parse(str(fd, "payload"));
    } catch {
      throw new BadRequestError("The report could not be read");
    }
    const id = str(fd, "id");
    const saved = id ? await svc.updateReport(ctx, id, payload) : await svc.createReport(ctx, payload);
    revalidatePath("/reports");
    return { message: "Report saved", redirect: `/reports/${saved.id}` };
  });
}

/** "Save a copy" of a standard or shared report into the viewer's private folder. */
export async function cloneReportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const source = await svc.getReport(ctx, str(fd, "id"));
    const copy = await svc.createReport(ctx, { name: `${source.name} (copy)`.slice(0, 120), description: source.description ?? undefined, folder: "PRIVATE", definition: source.definition });
    revalidatePath("/reports");
    return { message: "Copy saved to your private reports", redirect: `/reports/${copy.id}/edit` };
  });
}

export async function deleteReportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.deleteReport(await requireContext(), str(fd, "id"));
    revalidatePath("/reports");
    return { message: "Report deleted", redirect: "/reports" };
  });
}
