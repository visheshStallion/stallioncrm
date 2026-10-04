"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { parseLayoutText } from "@/server/modules/customization/layout-text";
import * as customization from "@/server/modules/customization/service";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

// ── import wizard ──
export async function uploadImportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BadRequestError("Choose a CSV or XLSX file");
    if (file.size > svc.MAX_IMPORT_BYTES) throw new BadRequestError("Files can be at most 5 MB");
    const job = await svc.createImport(ctx, str(fd, "module"), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return { message: "File uploaded – check the column mapping", redirect: `/imports/${job.id}` };
  });
}

/** Saves the mapping from the wizard form (`col:<header>` selects, value-mapping lines, dedupe, defaults). */
export async function saveMappingAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const columns: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("col:")) columns[k.slice(4)] = String(v);
    // value mapping lines: "field: value in file = our value"
    const values: Record<string, Record<string, string>> = {};
    for (const line of str(fd, "valueMap").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*=\s*(.+?)\s*$/.exec(line);
      if (m) (values[m[1]!] ??= {})[m[2]!.toLowerCase()] = m[3]!;
    }
    await svc.dryRun(ctx, str(fd, "id"), { columns, values, dedupe: str(fd, "dedupe"), defaultBrand: str(fd, "defaultBrand"), defaultRegion: str(fd, "defaultRegion") });
    revalidatePath(`/imports/${str(fd, "id")}`);
    return { message: "Mapping saved – dry run updated" };
  });
}

export async function commitImportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const summary = await svc.commitImport(await requireContext(), str(fd, "id"));
    revalidatePath("/imports");
    return { message: `Import started: ${summary.create} to create, ${summary.update} to update`, redirect: `/imports/${str(fd, "id")}` };
  });
}

export async function undoImportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await svc.undoImport(await requireContext(), str(fd, "id"));
    revalidatePath("/imports");
    return { message: `Import undone: ${res.removed} records removed` };
  });
}

export async function discardImportAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.discardImport(await requireContext(), str(fd, "id"));
    revalidatePath("/imports");
    return { message: "Import discarded", redirect: "/imports" };
  });
}

export async function saveTemplateAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.saveMapping(await requireContext(), str(fd, "id"), str(fd, "name"), fd.get("shared") === "on");
    revalidatePath(`/imports/${str(fd, "id")}`);
    return { message: "Mapping template saved" };
  });
}

export async function applyTemplateAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.applyMapping(await requireContext(), str(fd, "id"), str(fd, "mappingId"));
    revalidatePath(`/imports/${str(fd, "id")}`);
    return { message: "Mapping template applied" };
  });
}

// ── custom fields & layouts (administrators) ──
export async function saveCustomFieldAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    await customization.saveCustomField(ctx, str(fd, "id") || null, {
      module: str(fd, "module"),
      apiName: str(fd, "apiName"),
      label: str(fd, "label"),
      type: str(fd, "type"),
      options: str(fd, "options"),
      lookupTarget: str(fd, "lookupTarget"),
      formula: str(fd, "formula"),
      brandId: str(fd, "brandId"),
      required: fd.get("required") === "on",
      active: fd.get("active") === "on",
      position: str(fd, "position") || "0",
    });
    revalidatePath("/admin/customization");
    return { message: "Custom field saved", redirect: `/admin/customization?module=${str(fd, "module")}` };
  });
}

export async function toggleFieldIndexAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const on = str(fd, "indexed") === "true";
    await customization.setCustomFieldIndexed(await requireContext(), str(fd, "id"), on);
    revalidatePath("/admin/customization");
    return { message: on ? "Index created – the field filters and sorts fast" : "Index removed" };
  });
}

/** The layout editor posts the layout in its text notation (see layout-text.ts). */
export async function saveLayoutAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    let payload: unknown;
    try {
      payload = parseLayoutText({ sections: str(fd, "sections"), required: str(fd, "required"), rules: str(fd, "rules") });
    } catch (e) {
      throw new BadRequestError(e instanceof Error ? e.message : "The layout could not be read");
    }
    await customization.saveLayout(await requireContext(), str(fd, "module"), str(fd, "brandId") || null, payload);
    revalidatePath("/admin/customization");
    return { message: "Layout saved" };
  });
}
