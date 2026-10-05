/**
 * Bulk print (prompt 20 §A1): selected records → one merged PDF, or a ZIP of separate PDFs, built by a background
 * job and offered on the Exports page for 24 hours. The request is refused unless EVERY id is visible to the user
 * (nothing is skipped silently); the job renders again with the user's access at that moment.
 */
import "server-only";
import type { Job } from "@prisma/client";
import { zipStore } from "@/lib/xlsx";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { BadRequestError } from "@/server/errors";
import { notify } from "@/server/modules/notifications/service";
import { storage } from "@/server/storage";
import { printModule } from "./modules";
import { mergePdfs } from "./pdf";
import { MAX_BULK, loadPrintRecord, renderPrintPdf } from "./service";

const EXPIRY_HOURS = 24;

export async function requestBulkPrint(ctx: AccessContext, input: { module: string; ids: string[]; templateId?: string | null; format: "pdf" | "zip" }) {
  const mod = printModule(input.module);
  if (!mod) throw new BadRequestError("Unknown module");
  const ids = [...new Set(input.ids.filter(Boolean))];
  if (!ids.length) throw new BadRequestError("Select at least one record");
  if (ids.length > MAX_BULK) throw new BadRequestError(`At most ${MAX_BULK} records per print job`);
  // the job only ever receives ids the user can open (and, for customer lists, may export)
  await renderGuard(ctx, mod.key, ids);
  const job = await scopedDb(ctx).exportJob.create({ data: { userId: ctx.userId, module: `print:${mod.key}`, format: input.format, params: { ids, templateId: input.templateId ?? null }, status: "QUEUED" } });
  await enqueueJob({ type: "print.bulk", payload: { exportId: job.id, userId: ctx.userId }, idempotencyKey: `print:${job.id}`, maxAttempts: 2 });
  await audit({ ctx, action: "EXPORT", entity: "Print", entityId: `${mod.key}:bulk`, after: { module: mod.key, via: "bulk-request", records: ids.length, format: input.format, queued: job.id } });
  return { jobId: job.id, records: ids.length };
}

/** Loads every record once with the user's access – throws 404 / 403 exactly as a single print would. */
async function renderGuard(ctx: AccessContext, module: string, ids: string[]) {
  const mod = printModule(module)!;
  if (ids.length > 1 && mod.exportSensitive) {
    const { hasPermission } = await import("@/server/access/can");
    const { ForbiddenError } = await import("@/server/access/errors");
    if (!hasPermission(ctx, mod.permission, "export")) throw new ForbiddenError(`Printing several ${mod.plural.toLowerCase()} needs the export permission`);
  }
  for (const id of ids) await loadPrintRecord(ctx, module, id);
}

/** Job handler "print.bulk". */
export async function runBulkPrint(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { exportId, userId } = job.payload as { exportId: string; userId: string };
  const ctx = await loadAccessContext(userId);
  if (!ctx) return { skipped: "the user is no longer active" };
  const db = scopedDb(ctx);
  const row = await db.exportJob.findUnique({ where: { id: exportId } });
  if (!row || row.status !== "QUEUED") return { skipped: "print job is not queued" };
  const module = row.module.replace(/^print:/, "");
  const mod = printModule(module);
  const params = row.params as { ids: string[]; templateId: string | null };
  await db.exportJob.update({ where: { id: exportId }, data: { status: "RUNNING" } });
  try {
    if (!mod) throw new Error("Unknown module");
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    let pages = 0;
    // one record at a time: each PDF is rendered with the user's current access and on its own brand's letterhead
    for (const id of params.ids) {
      const pdf = await renderPrintPdf(ctx, { module, recordIds: [id], templateId: params.templateId, via: "bulk" });
      pages += pdf.pages;
      const name = files.some((f) => f.name === pdf.fileName) ? pdf.fileName.replace(/\.pdf$/, `-${files.length + 1}.pdf`) : pdf.fileName;
      files.push({ name, bytes: pdf.bytes });
    }
    const zip = row.format === "zip";
    const body = zip ? zipStore(files.map((f) => ({ name: f.name, data: f.bytes }))) : await mergePdfs(files.map((f) => f.bytes));
    const fileName = `${mod.plural.replace(/\s+/g, "-")}-${files.length}.${zip ? "zip" : "pdf"}`;
    const storageKey = `exports/${userId}/${exportId}.${zip ? "zip" : "pdf"}`;
    await storage().put(storageKey, body, zip ? "application/zip" : "application/pdf");
    await db.exportJob.update({ where: { id: exportId }, data: { status: "DONE", rowCount: files.length, storageKey, fileName, finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPIRY_HOURS * 3_600_000) } });
    await notify(ctx, [userId], { kind: "INFO", title: `Your ${mod.plural} printout is ready`, body: `${files.length} record(s), ${pages} page(s) · the link expires in ${EXPIRY_HOURS} hours`, href: "/exports" });
    return { records: files.length, pages };
  } catch (err) {
    await db.exportJob.update({ where: { id: exportId }, data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
}
