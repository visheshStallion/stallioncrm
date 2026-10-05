"use server";

import { revalidatePath } from "next/cache";
import type { AccessContext } from "@/server/access/types";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import type { Orientation, Paper } from "./blocks";
import * as svc from "./service";

export interface FormOutcome {
  message?: string;
  redirect?: string;
}
type Result = ActionResult<FormOutcome>;

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();
const opt = (fd: FormData, key: string) => str(fd, key) || null;
const req = (fd: FormData, key: string) => {
  const v = str(fd, key);
  if (!v) throw new BadRequestError(`${key} is required`);
  return v;
};

async function run(fn: (ctx: AccessContext) => Promise<FormOutcome | string | void>): Promise<Result> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const out = await fn(ctx);
    revalidatePath("/setup", "layout");
    return typeof out === "string" ? { message: out } : (out ?? { message: "Saved" });
  });
}

// ── letterhead ──
export async function saveLetterheadAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const brand = await svc.saveLetterhead(ctx, req(fd, "brandId"), {
      legalEntity: opt(fd, "legalEntity"),
      rcNumber: opt(fd, "rcNumber"),
      address: opt(fd, "address"),
      phone: opt(fd, "phone"),
      contactEmail: str(fd, "contactEmail"),
      website: opt(fd, "website"),
      vatNumber: opt(fd, "vatNumber"),
      bankDetails: opt(fd, "bankDetails"),
      color: str(fd, "color"),
      footerText: opt(fd, "footerText"),
      copyWatermark: fd.get("copyWatermark") === "on",
    });
    return `Letterhead of ${brand.code} saved`;
  });
}

export async function saveLetterheadLogoAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const brandId = req(fd, "brandId");
    if (fd.get("_intent") === "remove") {
      await svc.saveLetterheadLogo(ctx, brandId, null);
      return "Logo removed";
    }
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new BadRequestError("Choose a logo file");
    if (file.size > svc.MAX_LETTERHEAD_LOGO) throw new BadRequestError("The logo must be 1 MB or smaller");
    await svc.saveLetterheadLogo(ctx, brandId, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type });
    return "Logo saved";
  });
}

// ── print templates (designer) ──
// The designer is a client component and calls these with plain values.

export async function createTemplateAction(input: { module: string; name: string; brandId: string | null; paper: Paper; orientation: Orientation; layout: unknown }): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const t = await svc.createTemplate(await requireContext(), input);
    revalidatePath("/setup/print-templates");
    return { id: t.id };
  });
}

export async function saveTemplateDraftAction(id: string, input: { name: string; paper: Paper; orientation: Orientation; layout: unknown }): Promise<ActionResult<{ message: string }>> {
  return safeAction(async () => {
    await svc.saveTemplateDraft(await requireContext(), id, input);
    revalidatePath("/setup/print-templates");
    return { message: "Draft saved – publish it to print with it" };
  });
}

export async function publishTemplateAction(id: string, input: { name: string; paper: Paper; orientation: Orientation; layout: unknown }): Promise<ActionResult<{ message: string; version: number }>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    await svc.saveTemplateDraft(ctx, id, input);
    const version = await svc.publishTemplate(ctx, id);
    revalidatePath("/setup/print-templates");
    return { message: `Published as version ${version}`, version };
  });
}

export async function revertTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.revertTemplate(ctx, req(fd, "templateId"), Number(req(fd, "version")));
    return `Version ${req(fd, "version")} loaded as the draft – review and publish it`;
  });
}

export async function setTemplateFlagsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const flags: { isDefault?: boolean; active?: boolean } = {};
    if (fd.has("isDefault")) flags.isDefault = str(fd, "isDefault") === "true";
    if (fd.has("active")) flags.active = str(fd, "active") === "true";
    await svc.setTemplateFlags(ctx, req(fd, "templateId"), flags);
    return "Saved";
  });
}

export async function deleteTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteTemplate(ctx, req(fd, "templateId"));
    return { message: "Template deleted", redirect: "/setup/print-templates" };
  });
}
