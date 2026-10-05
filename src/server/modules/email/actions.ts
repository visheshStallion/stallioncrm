"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as svc from "./service";
import * as tpl from "./templates";

export interface EmailOutcome {
  message?: string;
  redirect?: string;
}

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

/** The composer posts its state as one JSON field (`payload`) next to the uploaded files. */
function payload(fd: FormData): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(str(fd, "payload"));
    if (!value || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BadRequestError("The e-mail could not be read – reload the page and try again");
  }
}

async function uploads(fd: FormData): Promise<svc.Upload[]> {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 10) throw new BadRequestError("At most 10 files can be attached");
  if (files.reduce((n, f) => n + f.size, 0) > svc.MAX_ATTACH_BYTES) throw new BadRequestError("The attachments are larger than 10 MB in total");
  return Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

// ── composer ──
export async function sendEmailAction(fd: FormData): Promise<ActionResult<EmailOutcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const input = payload(fd);
    const res = await svc.sendEmail(ctx, input, await uploads(fd));
    if (res.status !== "SENT") throw new BadRequestError(`The e-mail was not sent: ${res.error ?? "the mail service refused it"}`);
    const draftId = str(fd, "draftId");
    if (draftId) await svc.discardDraft(ctx, draftId).catch(() => undefined);
    const path = svc.PARENT_INFO[input.parentType as svc.EmailParent]?.path;
    revalidatePath(`${path}/${String(input.parentId)}`);
    return { message: `E-mail sent from ${res.from}`, redirect: `${path}/${String(input.parentId)}` };
  });
}

export async function testEmailAction(fd: FormData): Promise<ActionResult<EmailOutcome>> {
  return safeAction(async () => ({ message: `Test sent to ${await svc.sendTestEmail(await requireContext(), payload(fd))}` }));
}

export async function previewEmailAction(fd: FormData): Promise<ActionResult<{ subject: string; html: string }>> {
  return safeAction(async () => svc.previewEmail(await requireContext(), payload(fd)));
}

/** Saves a draft; with `sendAt` (ISO time) the e-mail is scheduled. */
export async function saveDraftAction(fd: FormData): Promise<ActionResult<EmailOutcome & { id: string }>> {
  return safeAction(async () => {
    const at = str(fd, "sendAt");
    const sendAt = at ? new Date(at) : null;
    if (sendAt && Number.isNaN(sendAt.getTime())) throw new BadRequestError("Choose a valid date and time");
    const res = await svc.saveDraft(await requireContext(), str(fd, "draftId") || null, payload(fd), sendAt);
    return { id: res.id, message: sendAt ? `Scheduled for ${sendAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Draft saved" };
  });
}

export async function discardDraftAction(_p: unknown, fd: FormData): Promise<ActionResult<EmailOutcome>> {
  return safeAction(async () => {
    await svc.discardDraft(await requireContext(), str(fd, "draftId"));
    revalidatePath("/email/compose");
    return { message: "Removed" };
  });
}

// ── signatures ──
export async function saveSignatureAction(fd: FormData): Promise<ActionResult<EmailOutcome>> {
  return safeAction(async () => {
    await svc.saveSignature(await requireContext(), str(fd, "brandId"), (fd.get("html") ?? "").toString());
    revalidatePath("/setup/personal");
    return { message: "Signature saved" };
  });
}

// ── templates ──
function templateInput(fd: FormData): tpl.RichTemplateInput {
  const p = payload(fd);
  return { brandId: (p.brandId as string) || null, name: String(p.name ?? ""), module: (p.module as string) || null, folder: (p.folder as string) || null, category: p.category as tpl.RichTemplateInput["category"], subject: String(p.subject ?? ""), doc: p.doc, active: p.active !== false };
}

export async function saveRichTemplateAction(fd: FormData): Promise<ActionResult<EmailOutcome & { id: string; warnings: string[] }>> {
  return safeAction(async () => {
    const id = str(fd, "templateId") || null;
    const res = await tpl.saveRichTemplate(await requireContext(), id, templateInput(fd));
    revalidatePath("/campaigns/templates", "layout");
    return { id: res.id, warnings: res.lint.warnings, message: `Template saved – version ${res.version}, ${res.lint.sizeKb} KB`, redirect: id ? undefined : `/campaigns/templates/email/${res.id}` };
  });
}

export async function previewTemplateAction(fd: FormData): Promise<ActionResult<{ html: string; lint: tpl.Lint | null }>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const input = templateInput(fd);
    const html = await tpl.previewTemplate(ctx, { brandId: input.brandId, category: input.category, doc: input.doc });
    const doc = svc.parseDoc(svc.cleanDoc(input.doc));
    return { html, lint: doc ? tpl.lintTemplate({ category: input.category, subject: input.subject, doc }) : null };
  });
}

export async function restoreTemplateVersionAction(_p: unknown, fd: FormData): Promise<ActionResult<EmailOutcome>> {
  return safeAction(async () => {
    const id = str(fd, "templateId");
    const res = await tpl.restoreTemplateVersion(await requireContext(), id, Number(str(fd, "version")));
    revalidatePath("/campaigns/templates", "layout");
    return { message: `Restored as version ${res.version}`, redirect: `/campaigns/templates/email/${id}` };
  });
}
