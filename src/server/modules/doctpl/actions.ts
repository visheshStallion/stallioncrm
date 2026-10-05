"use server";

import { revalidatePath } from "next/cache";
import type { AccessContext } from "@/server/access/types";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as svc from "./service";

export interface DocOutcome {
  message?: string;
  redirect?: string;
}
type Result = ActionResult<DocOutcome>;

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

async function run(fn: (ctx: AccessContext) => Promise<DocOutcome | string>): Promise<Result> {
  return safeAction(async () => {
    const out = await fn(await requireContext());
    revalidatePath("/templates/documents", "layout");
    return typeof out === "string" ? { message: out } : out;
  });
}

function json(fd: FormData): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(str(fd, "payload"));
    if (!value || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BadRequestError("The template could not be read – reload the page and try again");
  }
}

export async function createDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const brand = str(fd, "brandId");
    const visibility = str(fd, "visibility") || "PERSONAL";
    const t = await svc.createTemplate(ctx, { name: str(fd, "name"), module: str(fd, "module"), brandId: visibility === "GROUP" || !brand ? null : brand, visibility: visibility as "PERSONAL", starter: str(fd, "starter") || null });
    return { message: "Template created", redirect: `/templates/documents/${t.id}` };
  });
}

// The builder is a client component: it posts its state as one JSON field.

export async function saveDocTemplateAction(fd: FormData): Promise<ActionResult<DocOutcome & { droppedCss: string[] }>> {
  return safeAction(async () => {
    const p = json(fd);
    const res = await svc.saveTemplate(await requireContext(), str(fd, "templateId"), p as never);
    revalidatePath("/templates/documents", "layout");
    return { message: "Saved", droppedCss: res.droppedCss };
  });
}

export async function previewDocTemplateAction(fd: FormData): Promise<ActionResult<Awaited<ReturnType<typeof svc.previewTemplate>>>> {
  return safeAction(async () => svc.previewTemplate(await requireContext(), json(fd)));
}

export async function publishDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => `Published – version ${(await svc.publishTemplate(ctx, str(fd, "templateId"), str(fd, "note") || null)).version}`);
}

export async function submitDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => ((await svc.submitTemplate(ctx, str(fd, "templateId"))).status === "APPROVED" ? "Approved and published" : "Sent for approval to the brand's Brand Admin"));
}

export async function defaultDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const on = str(fd, "on") === "1";
    await svc.setDefault(ctx, str(fd, "templateId"), on);
    return on ? "This is now the default template" : "No longer the default";
  });
}

export async function archiveDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const archived = str(fd, "archived") === "1";
    await svc.archiveTemplate(ctx, str(fd, "templateId"), archived);
    return archived ? "Archived" : "Restored";
  });
}

export async function deleteDocTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteTemplate(ctx, str(fd, "templateId"));
    return { message: "Template deleted", redirect: "/templates/documents" };
  });
}

export async function restoreDocVersionAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.restoreVersion(ctx, str(fd, "templateId"), Number(str(fd, "version")));
    return `Version ${str(fd, "version")} is in the editor – publish it to use it`;
  });
}

/** Bulk send from a list view: the job is queued and the user lands on Exports, where the report appears. */
export async function bulkSendAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const { requestBulkSend } = await import("./bulk");
    const res = await requestBulkSend(ctx, { module: str(fd, "module"), ids: str(fd, "ids").split(",").filter(Boolean), documentTemplate: str(fd, "documentTemplate") || "default", emailTemplateId: str(fd, "emailTemplateId") || null });
    return { message: `Sending ${res.records} document(s) – the report will be under Exports`, redirect: "/exports" };
  });
}
