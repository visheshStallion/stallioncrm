/**
 * Database access for printing and the e-mail editor (prompt 20). The print-template history, signatures and drafts
 * are closed to user sessions, and letterheads read the brand's logo bytes, so this file uses the system client.
 * NOTHING here checks access: every caller is a service that has already decided what the user may see or change.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

const LETTERHEAD = { id: true, code: true, name: true, legalEntity: true, rcNumber: true, address: true, phone: true, contactEmail: true, fromEmail: true, website: true, vatNumber: true, bankDetails: true, color: true, footerText: true, logoData: true, logoMimeType: true, copyWatermark: true, status: true } as const;

export const brandLetterheadRows = (brandIds: string[]) => unsafeDb.brand.findMany({ where: { id: { in: brandIds } }, select: LETTERHEAD });
export type LetterheadRow = Awaited<ReturnType<typeof brandLetterheadRows>>[number];

export const updateLetterhead = (brandId: string, data: Prisma.BrandUpdateInput) => unsafeDb.brand.update({ where: { id: brandId }, data, select: { id: true, code: true } });
export const letterheadEditRow = (brandId: string) =>
  unsafeDb.brand.findUnique({ where: { id: brandId }, select: { id: true, code: true, name: true, legalEntity: true, rcNumber: true, address: true, phone: true, contactEmail: true, website: true, vatNumber: true, bankDetails: true, color: true, footerText: true, copyWatermark: true, logoMimeType: true } });

// ───────────────────────────── print templates ─────────────────────────────

/** Templates of a module that are usable for a set of brands (all-brand templates included). */
export const printTemplates = (where: Prisma.PrintTemplateWhereInput) => unsafeDb.printTemplate.findMany({ where, orderBy: [{ module: "asc" }, { name: "asc" }], include: { brand: { select: { code: true } } } });
export const printTemplate = (id: string) => unsafeDb.printTemplate.findUnique({ where: { id }, include: { brand: { select: { code: true } }, versions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, createdAt: true, createdById: true } } } });
export const printTemplateVersion = (templateId: string, version: number) => unsafeDb.printTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
export const createPrintTemplate = (data: Prisma.PrintTemplateUncheckedCreateInput) => unsafeDb.printTemplate.create({ data });
export const updatePrintTemplate = (id: string, data: Prisma.PrintTemplateUncheckedUpdateInput) => unsafeDb.printTemplate.update({ where: { id }, data });
export const deletePrintTemplate = (id: string) => unsafeDb.printTemplate.delete({ where: { id } });

/** Publishes a layout: the new version becomes the layout, the draft is cleared, the version is kept in the history. */
export async function publishPrintTemplate(id: string, layout: Prisma.InputJsonValue, userId: string) {
  return unsafeDb.$transaction(async (tx) => {
    const current = await tx.printTemplate.findUniqueOrThrow({ where: { id }, select: { version: true } });
    const version = current.version + 1;
    await tx.printTemplateVersion.create({ data: { templateId: id, version, layout, createdById: userId } });
    return tx.printTemplate.update({ where: { id }, data: { layout, draft: null as unknown as Prisma.InputJsonValue, version, updatedById: userId } });
  });
}

/** Only one default per module and brand. */
export async function setDefaultPrintTemplate(id: string, module: string, brandId: string | null) {
  await unsafeDb.$transaction([unsafeDb.printTemplate.updateMany({ where: { module, brandId, isDefault: true }, data: { isDefault: false } }), unsafeDb.printTemplate.update({ where: { id }, data: { isDefault: true } })]);
}

/** How often a record was printed before (the COPY watermark of documents). */
export const printCount = (module: string, recordId: string) => unsafeDb.auditLog.count({ where: { entity: "Print", entityId: `${module}:${recordId}`, action: "EXPORT" } });

export const profileNameOf = (profileId: string) => unsafeDb.profile.findUnique({ where: { id: profileId }, select: { name: true } });

// ───────────────────────────── e-mail: signatures, drafts, template versions ─────────────────────────────

export const signatureOf = (userId: string, brandId: string) => unsafeDb.emailSignature.findUnique({ where: { userId_brandId: { userId, brandId } } });
export const signaturesOf = (userId: string) => unsafeDb.emailSignature.findMany({ where: { userId } });
export const saveSignature = (userId: string, brandId: string, html: string) => unsafeDb.emailSignature.upsert({ where: { userId_brandId: { userId, brandId } }, update: { html }, create: { userId, brandId, html } });
export const deleteSignature = (userId: string, brandId: string) => unsafeDb.emailSignature.deleteMany({ where: { userId, brandId } });

export const createDraft = (data: Prisma.EmailDraftUncheckedCreateInput) => unsafeDb.emailDraft.create({ data });
export const updateDraft = (id: string, userId: string, data: Prisma.EmailDraftUncheckedUpdateInput) => unsafeDb.emailDraft.updateMany({ where: { id, userId }, data });
export const draftOf = (id: string) => unsafeDb.emailDraft.findUnique({ where: { id } });
export const draftsOf = (userId: string, parentType: string, parentId: string) => unsafeDb.emailDraft.findMany({ where: { userId, parentType, parentId, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: 20 });
/** Claims a scheduled draft for sending; false when it was cancelled, edited back to a draft or already sent. */
export async function claimScheduledDraft(id: string): Promise<boolean> {
  return (await unsafeDb.emailDraft.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "SENDING" } })).count === 1;
}

export const templateVersions = (templateId: string) => unsafeDb.templateVersion.findMany({ where: { templateId }, orderBy: { version: "desc" }, take: 20 });
export const templateVersion = (templateId: string, version: number) => unsafeDb.templateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
export const addTemplateVersion = (data: Prisma.TemplateVersionUncheckedCreateInput) => unsafeDb.templateVersion.create({ data });

/** Where a message template is used: campaigns that are not finished and active workflow rules that send it. */
export async function templateUsage(templateId: string): Promise<Array<{ kind: string; name: string }>> {
  const [campaigns, rules] = await Promise.all([
    unsafeDb.campaign.findMany({ where: { templateId, status: { in: ["DRAFT", "SENDING"] } }, select: { name: true } }),
    unsafeDb.workflowRule.findMany({ where: { active: true }, select: { name: true, actions: true } }),
  ]);
  const used = rules.filter((r) => JSON.stringify(r.actions ?? "").includes(templateId));
  return [...campaigns.map((c) => ({ kind: "Campaign", name: c.name })), ...used.map((r) => ({ kind: "Workflow rule", name: r.name }))];
}
