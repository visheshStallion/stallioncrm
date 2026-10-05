/**
 * Database access for document templates and generated documents (prompt 21). These tables are closed to user
 * sessions, so this file uses the system client. NOTHING here checks access: every caller is the document-template
 * service, which has already decided what the user may see or change (visibility, brand, record access).
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

const WITH_BRAND = { brand: { select: { code: true, name: true } } } as const;

export const docTemplates = (where: Prisma.DocumentTemplateWhereInput) => unsafeDb.documentTemplate.findMany({ where, orderBy: [{ module: "asc" }, { name: "asc" }], include: WITH_BRAND });
export const docTemplate = (id: string) => unsafeDb.documentTemplate.findUnique({ where: { id }, include: { ...WITH_BRAND, versions: { orderBy: { version: "desc" }, take: 30, select: { version: true, changedAt: true, changedById: true, note: true } } } });
export type DocTemplateRow = NonNullable<Awaited<ReturnType<typeof docTemplate>>>;
export const docTemplateVersion = (templateId: string, version: number) => unsafeDb.documentTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
export const createDocTemplate = (data: Prisma.DocumentTemplateUncheckedCreateInput) => unsafeDb.documentTemplate.create({ data });
export const updateDocTemplate = (id: string, data: Prisma.DocumentTemplateUncheckedUpdateInput) => unsafeDb.documentTemplate.update({ where: { id }, data });
export const deleteDocTemplate = (id: string) => unsafeDb.documentTemplate.delete({ where: { id } });
export const userNames = async (ids: string[]) => new Map((await unsafeDb.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

/** Publishes the working copy: it becomes the version documents are generated with, and is kept in the history. */
export async function publishDocTemplate(id: string, userId: string, note: string | null) {
  return unsafeDb.$transaction(async (tx) => {
    const t = await tx.documentTemplate.findUniqueOrThrow({ where: { id } });
    const version = t.version + 1;
    await tx.documentTemplateVersion.create({ data: { templateId: id, version, snapshot: { name: t.name, paper: t.paper, orientation: t.orientation, margins: t.margins, content: t.content, cssOverrides: t.cssOverrides } as Prisma.InputJsonValue, changedById: userId, note } });
    return tx.documentTemplate.update({ where: { id }, data: { status: "PUBLISHED", published: t.content as Prisma.InputJsonValue, dirty: false, version, approvedById: userId, publishedAt: new Date() } });
  });
}

/** Only one default per module and brand. */
export async function setDefaultDocTemplate(id: string, module: string, brandId: string | null, on: boolean) {
  await unsafeDb.$transaction([unsafeDb.documentTemplate.updateMany({ where: { module, brandId, isDefault: true }, data: { isDefault: false } }), unsafeDb.documentTemplate.update({ where: { id }, data: { isDefault: on } })]);
}

export const touchDocTemplate = (id: string) => unsafeDb.documentTemplate.update({ where: { id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() }, select: { id: true } });

// ───────────────────────────── generated documents ─────────────────────────────

export const createGenerated = (data: Prisma.GeneratedDocumentUncheckedCreateInput) => unsafeDb.generatedDocument.create({ data, select: { id: true } });
export const generatedOf = (module: string, recordId: string) => unsafeDb.generatedDocument.findMany({ where: { module, recordId }, orderBy: { generatedAt: "desc" }, take: 50 });
export const generatedById = (id: string) => unsafeDb.generatedDocument.findUnique({ where: { id } });
export const linkGeneratedEmail = (id: string, emailActivityId: string) => unsafeDb.generatedDocument.update({ where: { id }, data: { emailActivityId }, select: { id: true } });
export const generatedCount = (templateId: string) => unsafeDb.generatedDocument.count({ where: { templateId } });

/** Marks a sales order or invoice as sent to the customer (system write: the caller has sent it with the user's access). */
export async function markDocumentSent(module: string, id: string): Promise<void> {
  if (module === "invoices") await unsafeDb.invoice.updateMany({ where: { id }, data: { sentAt: new Date() } });
  if (module === "salesOrders") await unsafeDb.salesOrder.updateMany({ where: { id }, data: { sentAt: new Date() } });
}
