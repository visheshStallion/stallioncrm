"use server";

import { revalidatePath } from "next/cache";
import type { AccessContext } from "@/server/access/types";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import * as rec from "@/server/modules/rectpl/service";
import { requireContext } from "@/server/request";
import * as hub from "./hub";

export interface HubOutcome {
  message?: string;
  redirect?: string;
}
type Result = ActionResult<HubOutcome>;

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

async function run(fn: (ctx: AccessContext) => Promise<HubOutcome | string>): Promise<Result> {
  return safeAction(async () => {
    const out = await fn(await requireContext());
    revalidatePath("/templates", "layout");
    revalidatePath("/setup/templates");
    return typeof out === "string" ? { message: out } : out;
  });
}

// ── hub rows ──
export async function favoriteAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const on = str(fd, "on") === "1";
    await hub.setFavorite(ctx, str(fd, "kind"), str(fd, "id"), on);
    return on ? "Added to your favourites" : "Removed from your favourites";
  });
}

export async function moveToFolderAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await hub.moveToFolder(ctx, str(fd, "kind"), str(fd, "id"), str(fd, "folderId"));
    return str(fd, "folderId") ? "Moved to the folder" : "Taken out of its folder";
  });
}

export async function cloneTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => ({ message: "Copy created", redirect: (await hub.cloneTemplate(ctx, str(fd, "kind"), str(fd, "id"))).href }));
}

export async function defaultTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const on = str(fd, "on") === "1";
    await hub.setDefault(ctx, str(fd, "kind"), str(fd, "id"), on);
    return on ? "This is now the default template" : "No longer the default";
  });
}

export async function archiveTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const archived = str(fd, "archived") === "1";
    await hub.archiveTemplate(ctx, str(fd, "kind"), str(fd, "id"), archived);
    return archived ? "Archived – no longer offered" : "Restored";
  });
}

export async function deleteTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await hub.deleteTemplate(ctx, str(fd, "kind"), str(fd, "id"));
    return { message: "Template deleted", ...(str(fd, "back") ? { redirect: str(fd, "back") } : {}) };
  });
}

// ── folders ──
export async function createFolderAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const scope = str(fd, "scope"); // "" = personal, "group", or a brand id
    await hub.createFolder(ctx, { name: str(fd, "name"), shared: scope !== "", brandId: scope && scope !== "group" ? scope : null });
    return "Folder created";
  });
}

export async function deleteFolderAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await hub.deleteFolder(ctx, str(fd, "folderId"));
    return { message: "Folder removed – its templates are still there", redirect: str(fd, "back") || undefined };
  });
}

// ── record templates ──
function payload(fd: FormData): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(str(fd, "payload"));
    if (!value || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BadRequestError("The template could not be read – reload the page and try again");
  }
}

/** The record template editor posts its state as one JSON field; without `templateId` a new template is created. */
export async function saveRecordTemplateAction(fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const p = payload(fd);
    const id = str(fd, "templateId");
    if (id) {
      const res = await rec.saveRecordTemplate(ctx, id, p.body as rec.RecordTemplateBody);
      return res.status === "DRAFT" ? `Saved as version ${res.version} – it needs to be published (or approved) before it can be used` : `Saved – version ${res.version}`;
    }
    const meta = p.meta as { module: string; brandId: string | null; visibility: rec.RtVisibility };
    const t = await rec.createRecordTemplate(ctx, { module: meta.module, brandId: meta.visibility === "PUBLIC_GROUP" ? null : meta.brandId || null, visibility: meta.visibility }, p.body as rec.RecordTemplateBody);
    return { message: "Template created", redirect: `/templates/records/${t.id}` };
  });
}

export async function publishRecordTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await rec.publishRecordTemplate(ctx, str(fd, "id"));
    return "Published – it is now offered under “Create from template”";
  });
}

export async function submitRecordTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => ((await rec.submitRecordTemplate(ctx, str(fd, "id"))).status === "APPROVED" ? "Approved and published" : "Sent for approval to the brand's Brand Admin"));
}

export async function restoreRecordTemplateVersionAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const res = await rec.restoreRecordTemplateVersion(ctx, str(fd, "id"), Number(str(fd, "version")));
    return { message: `Restored as version ${res.version}`, redirect: `/templates/records/${str(fd, "id")}?r=${res.version}` };
  });
}

/** "Save as template" on a record: a personal draft with the record's reusable values, opened in the editor. */
export async function saveRecordAsTemplateAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const t = await rec.saveRecordAsTemplate(ctx, str(fd, "module"), str(fd, "recordId"), str(fd, "name"));
    return { message: "Template created from the record – check the values and publish it", redirect: `/templates/records/${t.id}` };
  });
}
