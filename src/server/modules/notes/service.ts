/**
 * Notes and attachments on brand-owned records (prompt 04 §4). Both are brand-owned themselves: they copy
 * brand and region from the parent record, so scopedDb + RLS isolate them exactly like the parent.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { delegateName, isBrandOwnedModel } from "@/server/access/brand-owned";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { storage } from "@/server/storage";

/** Parent entities that can carry notes / attachments → their permission module. */
const PARENTS: Record<string, ModuleKey> = { Deal: "deals", Lead: "leads" };

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Loads the parent through the scoped client – NotFound when it is missing or outside the user's scope. */
async function loadParent(ctx: AccessContext, entity: string, entityId: string) {
  const moduleKey = PARENTS[entity];
  if (!moduleKey || !isBrandOwnedModel(entity)) throw new BadRequestError("Notes and attachments are not supported for this record type");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
  const parent = await (scopedDb(ctx) as any)[delegateName(entity)].findUnique({
    where: { id: entityId },
    select: { id: true, brandId: true, regionId: true, ownerId: true },
  });
  if (!parent) throw new NotFoundError();
  return { moduleKey, parent: parent as { id: string; brandId: string; regionId: string; ownerId: string } };
}

export async function listNotes(ctx: AccessContext, entity: string, entityId: string) {
  await loadParent(ctx, entity, entityId);
  const rows = await scopedDb(ctx).note.findMany({
    where: { entity, entityId },
    select: { id: true, body: true, createdAt: true, ownerId: true, owner: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((n) => ({ id: n.id, body: n.body, at: n.createdAt.toISOString(), author: n.owner.name, mine: n.ownerId === ctx.userId }));
}

export async function addNote(ctx: AccessContext, entity: string, entityId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 5000) throw new BadRequestError("A note must be 1–5000 characters");
  const { moduleKey, parent } = await loadParent(ctx, entity, entityId);
  assertCan(ctx, moduleKey, "edit", parent);
  return scopedDb(ctx).note.create({
    data: { entity, entityId, body: text, brandId: parent.brandId, regionId: parent.regionId, ownerId: ctx.userId },
    select: { id: true },
  });
}

/** Authors delete their own notes (soft delete); nobody else's. */
export async function deleteNote(ctx: AccessContext, id: string) {
  const res = await scopedDb(ctx).note.updateMany({ where: { id, ownerId: ctx.userId }, data: { deletedAt: new Date() } });
  if (res.count === 0) throw new NotFoundError();
}

export async function listAttachments(ctx: AccessContext, entity: string, entityId: string) {
  await loadParent(ctx, entity, entityId);
  const rows = await scopedDb(ctx).attachment.findMany({
    where: { entity, entityId },
    select: { id: true, fileName: true, contentType: true, size: true, createdAt: true, owner: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((a) => ({ id: a.id, fileName: a.fileName, contentType: a.contentType, size: a.size, at: a.createdAt.toISOString(), uploadedBy: a.owner.name }));
}

export async function addAttachment(
  ctx: AccessContext,
  entity: string,
  entityId: string,
  file: { name: string; type: string; bytes: Uint8Array },
) {
  if (file.bytes.byteLength === 0) throw new BadRequestError("The file is empty");
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new BadRequestError("Files can be at most 10 MB");
  if (!ALLOWED_TYPES.has(file.type)) throw new BadRequestError("Allowed files: PDF, images, text / CSV, Word and Excel documents");
  const { moduleKey, parent } = await loadParent(ctx, entity, entityId);
  assertCan(ctx, moduleKey, "edit", parent);
  const db = scopedDb(ctx);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: parent.brandId }, select: { code: true } });
  const fileName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";
  // Brand-prefixed key, no user input in the path.
  const storageKey = `${brand.code}/${entity.toLowerCase()}/${entityId}/${randomUUID()}`;
  await storage().put(storageKey, file.bytes, file.type);
  return db.attachment.create({
    data: { entity, entityId, fileName, contentType: file.type, size: file.bytes.byteLength, storageKey, brandId: parent.brandId, regionId: parent.regionId, ownerId: ctx.userId },
    select: { id: true },
  });
}

/** Brand-scoped download: the attachment row is fetched through scopedDb (404 when hidden) before any bytes are read. */
export async function readAttachment(ctx: AccessContext, id: string) {
  const a = await scopedDb(ctx).attachment.findUnique({ where: { id }, select: { fileName: true, contentType: true, storageKey: true } });
  if (!a) throw new NotFoundError();
  return { fileName: a.fileName, contentType: a.contentType, bytes: await storage().get(a.storageKey) };
}

export async function deleteAttachment(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const a = await db.attachment.findUnique({ where: { id }, select: { ownerId: true, storageKey: true, brandId: true, regionId: true, entity: true } });
  if (!a) throw new NotFoundError();
  if (a.ownerId !== ctx.userId) assertCan(ctx, PARENTS[a.entity] ?? "deals", "delete", a);
  await db.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
  await storage().delete(a.storageKey).catch(() => undefined);
}
