/**
 * Database access for the templates hub (prompt 22): record templates with their history and uses, folders,
 * placements and favourites. These tables are closed to user sessions, so this file uses the system client.
 * NOTHING here checks access: every caller is a service that has already decided what the user may see or change.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

const WITH_BRAND = { brand: { select: { code: true, name: true } } } as const;

// ───────────────────────────── record templates ─────────────────────────────

export const recordTemplates = (where: Prisma.RecordTemplateWhereInput) => unsafeDb.recordTemplate.findMany({ where, orderBy: [{ module: "asc" }, { name: "asc" }], include: WITH_BRAND });
export const recordTemplate = (id: string) => unsafeDb.recordTemplate.findUnique({ where: { id }, include: { ...WITH_BRAND, versions: { orderBy: { version: "desc" }, take: 30, select: { version: true, changedAt: true, changedById: true } } } });
export type RecordTemplateRow = Awaited<ReturnType<typeof recordTemplates>>[number];
export const recordTemplateVersion = (templateId: string, version: number) => unsafeDb.recordTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
export const createRecordTemplate = (data: Prisma.RecordTemplateUncheckedCreateInput) => unsafeDb.recordTemplate.create({ data });
export const updateRecordTemplate = (id: string, data: Prisma.RecordTemplateUncheckedUpdateInput) => unsafeDb.recordTemplate.update({ where: { id }, data });
export const deleteRecordTemplate = (id: string) => unsafeDb.recordTemplate.delete({ where: { id } });
export const addRecordTemplateVersion = (templateId: string, version: number, snapshot: Prisma.InputJsonValue, changedById: string) => unsafeDb.recordTemplateVersion.upsert({ where: { templateId_version: { templateId, version } }, update: { snapshot, changedById }, create: { templateId, version, snapshot, changedById } });

/** Only one default per module and brand. */
export async function setDefaultRecordTemplate(id: string, module: string, brandId: string | null, on: boolean) {
  await unsafeDb.$transaction([unsafeDb.recordTemplate.updateMany({ where: { module, brandId, isDefault: true }, data: { isDefault: false } }), unsafeDb.recordTemplate.update({ where: { id }, data: { isDefault: on } })]);
}

/** A record was created from a template: the link (one per record) and the template's counter. */
export async function recordUse(data: { templateId: string; templateVersion: number; module: string; recordId: string; brandId: string | null; userId: string }) {
  await unsafeDb.$transaction([
    unsafeDb.recordTemplateUse.upsert({ where: { module_recordId: { module: data.module, recordId: data.recordId } }, update: {}, create: data }),
    unsafeDb.recordTemplate.update({ where: { id: data.templateId }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } }),
  ]);
}
export const useOfRecord = (module: string, recordId: string) => unsafeDb.recordTemplateUse.findUnique({ where: { module_recordId: { module, recordId } }, include: { template: { select: { name: true } } } });
export const usesSince = (templateId: string, since: Date) => unsafeDb.recordTemplateUse.count({ where: { templateId, createdAt: { gte: since } } });

export const userNames = async (ids: string[]) => new Map((await unsafeDb.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

// ───────────────────────────── hub: message / print templates of other stores ─────────────────────────────

/** Message templates (e-mail, SMS, WhatsApp) of the given brands and the group, with their owner. */
export const messageTemplates = (brandIds: string[]) => unsafeDb.template.findMany({ where: { OR: [{ brandId: null }, { brandId: { in: brandIds } }] }, orderBy: { name: "asc" }, include: WITH_BRAND });
/** How often each message template was used for a message. */
export async function messageTemplateUsage(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await unsafeDb.message.groupBy({ by: ["templateId"], where: { templateId: { in: ids } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.templateId as string, r._count._all]));
}
export const printTemplatesOf = (brandIds: string[]) => unsafeDb.printTemplate.findMany({ where: { OR: [{ brandId: null }, { brandId: { in: brandIds } }] }, orderBy: { name: "asc" }, include: WITH_BRAND });

/** Where templates are referenced: campaigns (draft / sending) and active workflow rules (their actions as text). */
export async function associations() {
  const [campaigns, rules] = await Promise.all([
    unsafeDb.campaign.findMany({ where: { templateId: { not: null }, status: { in: ["DRAFT", "SENDING"] } }, select: { name: true, templateId: true, brandId: true } }),
    unsafeDb.workflowRule.findMany({ where: { active: true }, select: { name: true, actions: true } }),
  ]);
  return { campaigns, rules: rules.map((r) => ({ name: r.name, actions: JSON.stringify(r.actions ?? "") })) };
}

// ───────────────────────────── folders, placements, favourites ─────────────────────────────

export const folders = (userId: string, brandIds: string[]) => unsafeDb.templateFolder.findMany({ where: { OR: [{ ownerId: userId, shared: false }, { shared: true, OR: [{ brandId: null }, { brandId: { in: brandIds } }] }] }, orderBy: { name: "asc" }, include: { ...WITH_BRAND, _count: { select: { placements: true } } } });
export const folder = (id: string) => unsafeDb.templateFolder.findUnique({ where: { id } });
export const createFolder = (data: Prisma.TemplateFolderUncheckedCreateInput) => unsafeDb.templateFolder.create({ data });
export const renameFolder = (id: string, name: string) => unsafeDb.templateFolder.update({ where: { id }, data: { name } });
export const deleteFolder = (id: string) => unsafeDb.templateFolder.delete({ where: { id } });
export const placements = (userId: string) => unsafeDb.templatePlacement.findMany({ where: { scope: { in: ["", userId] } } });
export const place = (kind: string, templateId: string, scope: string, folderId: string) => unsafeDb.templatePlacement.upsert({ where: { kind_templateId_scope: { kind, templateId, scope } }, update: { folderId }, create: { kind, templateId, scope, folderId } });
export const unplace = (kind: string, templateId: string, scopes: string[]) => unsafeDb.templatePlacement.deleteMany({ where: { kind, templateId, scope: { in: scopes } } });
export const favorites = (userId: string) => unsafeDb.templateFavorite.findMany({ where: { userId } });
export async function setFavorite(userId: string, kind: string, templateId: string, on: boolean) {
  if (on) await unsafeDb.templateFavorite.upsert({ where: { userId_kind_templateId: { userId, kind, templateId } }, update: {}, create: { userId, kind, templateId } });
  else await unsafeDb.templateFavorite.deleteMany({ where: { userId, kind, templateId } });
}
/** Removes everything the hub keeps about a deleted template. */
export async function forgetTemplate(kind: string, templateId: string) {
  await unsafeDb.$transaction([unsafeDb.templatePlacement.deleteMany({ where: { kind, templateId } }), unsafeDb.templateFavorite.deleteMany({ where: { kind, templateId } })]);
}
