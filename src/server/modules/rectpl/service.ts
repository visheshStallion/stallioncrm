/**
 * Record templates (prompt 22 §3): pre-filled values for creating a record in one click.
 *
 *   PERSONAL      only its author uses it.
 *   SHARED_BRAND  one brand; written by the brand's manager, its Brand Admin or an administrator; published by the
 *                 Brand Admin or an administrator (a brand manager submits it for approval).
 *   PUBLIC_GROUP  every brand; administrators only.
 *
 * A template never creates anything by itself and never widens access: the record is created by the module's own
 * create service with the CURRENT user's access, and every value of the template is validated again there (brand,
 * region, product of the brand, enum values). Prices are never stored: quote lines are priced from the current
 * price book when the quote is created.
 */
import "server-only";
import { z } from "zod";
import { managedBrands } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { defaultInboundRegion } from "@/server/db/messaging-system";
import * as store from "@/server/db/template-hub-store";
import { BadRequestError } from "@/server/errors";
import { getSetting } from "@/server/modules/setup/service";
import { RT_MODULES, rtModule, templateFields, type RtModule, type TemplateField } from "./modules";

type Row = store.RecordTemplateRow;
export const RT_VISIBILITIES = ["PERSONAL", "SHARED_BRAND", "PUBLIC_GROUP"] as const;
export type RtVisibility = (typeof RT_VISIBILITIES)[number];
export const RT_VISIBILITY_LABELS: Record<RtVisibility, string> = { PERSONAL: "Personal", SHARED_BRAND: "Shared (brand)", PUBLIC_GROUP: "Public (group)" };
export const RT_STATUS_LABELS: Record<string, string> = { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", PUBLISHED: "Published", ARCHIVED: "Archived" };

// ───────────────────────────── who may do what ─────────────────────────────

const isBrandAdmin = (ctx: AccessContext, brandId: string) => !!ctx.isAdmin || !!ctx.brandAdminOf?.includes(brandId);
type Scope = Pick<Row, "visibility" | "brandId" | "createdById" | "status">;

export function canPublish(ctx: AccessContext, t: Scope): boolean {
  if (t.visibility === "PERSONAL") return t.createdById === ctx.userId;
  if (t.visibility === "PUBLIC_GROUP") return !!ctx.isAdmin;
  return !!t.brandId && ctx.brandIds.includes(t.brandId) && isBrandAdmin(ctx, t.brandId);
}
export function canEdit(ctx: AccessContext, t: Scope): boolean {
  if (canPublish(ctx, t)) return true;
  return t.visibility === "SHARED_BRAND" && !!t.brandId && ctx.brandIds.includes(t.brandId) && managedBrands(ctx).includes(t.brandId);
}
export function canSee(ctx: AccessContext, t: Scope): boolean {
  if (t.createdById === ctx.userId) return true;
  if (t.visibility === "PERSONAL") return false;
  if (t.brandId && !ctx.brandIds.includes(t.brandId)) return false;
  return t.status === "PUBLISHED" || canEdit(ctx, t);
}
/** Usable to create a record now: published, visible, and of a module the user may create in. */
const usable = (ctx: AccessContext, t: Row) => t.status === "PUBLISHED" && canSee(ctx, t) && !!rtModule(t.module) && hasPermission(ctx, rtModule(t.module)!.permission, "create");

// ───────────────────────────── content ─────────────────────────────

const FORMULA = /^(today([+-]\d{1,4}d)?|currentUser|userRegion)$/;
const scalar = z.union([z.string().max(5000), z.number(), z.boolean(), z.null(), z.object({ $: z.string().regex(FORMULA, "Unknown formula") }).strict()]);
const childSchema = z.object({ subject: z.string().trim().min(1).max(200), type: z.enum(["TASK", "CALL", "MEETING"]).default("TASK"), dueInHours: z.coerce.number().min(0).max(24 * 365).default(24), priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL") });
const lineSchema = z.object({ productId: z.string().min(1).max(40), qty: z.coerce.number().int().min(1).max(10_000).default(1), discountPct: z.coerce.number().min(0).max(100).default(0) });
const bodySchema = z.object({
  name: z.string().trim().min(2, "Give the template a name").max(100),
  description: z.string().trim().max(500).nullish(),
  fieldValues: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/), scalar),
  lockedFields: z.array(z.string().max(60)).max(100).default([]),
  hiddenFields: z.array(z.string().max(60)).max(100).default([]),
  lineItems: z.array(lineSchema).max(50).default([]),
  childRecords: z.array(childSchema).max(20).default([]),
  emailTemplateId: z.string().max(40).nullish(),
  documentTemplateId: z.string().max(40).nullish(),
});
export type RecordTemplateBody = z.input<typeof bodySchema>;
type Body = z.output<typeof bodySchema>;
export type FieldValue = z.infer<typeof scalar>;

const isFormula = (v: unknown): v is { $: string } => typeof v === "object" && v !== null && typeof (v as { $?: unknown }).$ === "string";

/** Checks a template's values against the module's fields: unknown fields, wrong option, text in a number field. */
async function validate(ctx: AccessContext, mod: RtModule, brandId: string | null, raw: RecordTemplateBody): Promise<Body> {
  const body = bodySchema.parse(raw);
  const fields = new Map((await templateFields(mod)).map((f) => [f.name, f]));
  const values: Record<string, FieldValue> = {};
  for (const [name, value] of Object.entries(body.fieldValues)) {
    const f = fields.get(name);
    if (!f) throw new BadRequestError(`"${name}" is not a field of ${mod.plural.toLowerCase()} that a template can fill`);
    if (value === null || value === "") continue;
    if (mod.personal.includes(name)) throw new BadRequestError(`${f.label} belongs to one customer or record and cannot be part of a template`);
    if (isFormula(value)) {
      const ok = f.type === "date" ? value.$.startsWith("today") : name === "ownerId" ? value.$ === "currentUser" : name === "regionId" ? value.$ === "userRegion" : false;
      if (!ok) throw new BadRequestError(`${f.label}: this formula does not fit the field`);
    } else if (f.type === "select" && !f.options!.includes(String(value))) throw new BadRequestError(`${f.label}: "${String(value)}" is not one of ${f.options!.join(", ")}`);
    else if (f.type === "number" && !Number.isFinite(Number(value))) throw new BadRequestError(`${f.label} must be a number`);
    else if (f.type === "date" && Number.isNaN(new Date(String(value)).getTime())) throw new BadRequestError(`${f.label} must be a date or a formula such as today+30d`);
    // the brand of a template is its own brand – never a value among the fields
    if (name === "brandId") {
      if (brandId && value !== brandId) throw new BadRequestError("The brand of the record is the brand of the template");
      if (typeof value === "string" && !ctx.brandIds.includes(value)) throw new NotFoundError();
    }
    values[name] = f.type === "number" ? Number(value) : f.type === "bool" ? value === true || value === "true" || value === "on" : value;
  }
  const known = (list: string[]) => [...new Set(list)].filter((n) => fields.has(n) && n in values);
  if (body.lineItems.length && !mod.hasLines) throw new BadRequestError(`${mod.plural} have no line items`);
  if (body.childRecords.length && !mod.parentType) throw new BadRequestError(`${mod.plural} cannot have tasks from a template`);
  // products of the template's brand only (prices are not stored – they are read when the record is created)
  if (body.lineItems.length) {
    const products = await scopedDb(ctx).product.findMany({ where: { id: { in: body.lineItems.map((l) => l.productId) } }, select: { id: true, brandId: true } });
    for (const l of body.lineItems) {
      const p = products.find((x) => x.id === l.productId);
      if (!p) throw new NotFoundError();
      if (brandId && p.brandId !== brandId) throw new BadRequestError("A line item's product must belong to the template's brand");
    }
  }
  return { ...body, fieldValues: values, lockedFields: known(body.lockedFields), hiddenFields: known(body.hiddenFields) };
}

// ───────────────────────────── lists ─────────────────────────────

const view = (ctx: AccessContext, t: Row, names: Map<string, string>) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  module: t.module,
  moduleLabel: rtModule(t.module)?.plural ?? t.module,
  brandId: t.brandId,
  brandCode: t.brand?.code ?? null,
  visibility: t.visibility as RtVisibility,
  status: t.status,
  isDefault: t.isDefault,
  version: t.version,
  ownerId: t.createdById,
  ownerName: names.get(t.createdById) ?? "",
  mine: t.createdById === ctx.userId,
  usageCount: t.usageCount,
  updatedAt: t.updatedAt,
  emailTemplateId: t.emailTemplateId,
  documentTemplateId: t.documentTemplateId,
  editable: canEdit(ctx, t),
  publishable: canPublish(ctx, t),
});
export type RecordTemplateView = ReturnType<typeof view>;

export async function listRecordTemplates(ctx: AccessContext, filter: { module?: string | null } = {}): Promise<RecordTemplateView[]> {
  const rows = (await store.recordTemplates({ ...(filter.module ? { module: filter.module } : {}), OR: [{ brandId: null }, { brandId: { in: ctx.brandIds } }] })).filter((t) => canSee(ctx, t));
  const names = await store.userNames(rows.map((t) => t.createdById));
  return rows.map((t) => view(ctx, t, names));
}

/** Templates offered by "Create from template" of a module: published, visible, favourites are sorted by the hub. */
export async function pickerTemplates(ctx: AccessContext, moduleKey: string) {
  const rows = (await store.recordTemplates({ module: moduleKey, status: "PUBLISHED", OR: [{ brandId: null }, { brandId: { in: ctx.brandIds } }] })).filter((t) => usable(ctx, t));
  return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, brandCode: t.brand?.code ?? null, isDefault: t.isDefault, personal: t.visibility === "PERSONAL" }));
}

async function loadSeen(ctx: AccessContext, id: string) {
  const t = await store.recordTemplate(id);
  if (!t || !canSee(ctx, t) || !rtModule(t.module)) throw new NotFoundError();
  return t;
}

export async function getRecordTemplate(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  const mod = rtModule(t.module)!;
  const names = await store.userNames([t.createdById, ...t.versions.map((v) => v.changedById ?? "")]);
  return {
    ...view(ctx, t, names),
    fieldValues: (t.fieldValues ?? {}) as Record<string, FieldValue>,
    lockedFields: (t.lockedFields ?? []) as string[],
    hiddenFields: (t.hiddenFields ?? []) as string[],
    lineItems: (t.lineItems ?? []) as Array<{ productId: string; qty: number; discountPct: number }>,
    childRecords: (t.childRecords ?? []) as Array<{ subject: string; type: string; dueInHours: number; priority: string }>,
    emailTemplateId: t.emailTemplateId,
    documentTemplateId: t.documentTemplateId,
    fields: await templateFields(mod),
    personalFields: mod.personal,
    hasLines: !!mod.hasLines,
    hasChildren: !!mod.parentType,
    newHref: mod.newHref,
    document: mod.document ?? null,
    needsApproval: canEdit(ctx, t) && !canPublish(ctx, t),
    versions: t.versions.map((v) => ({ version: v.version, changedAt: v.changedAt, changedBy: names.get(v.changedById ?? "") ?? "" })),
    usedThisMonth: await store.usesSince(t.id, new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  };
}

// ───────────────────────────── create / change ─────────────────────────────

const metaSchema = z.object({ module: z.string().refine((m) => !!rtModule(m), "Record templates are not available for this module"), brandId: z.string().min(1).nullable(), visibility: z.enum(RT_VISIBILITIES) });
const snapshot = (t: Pick<Row, "name" | "status" | "version" | "visibility" | "module" | "isDefault">) => ({ name: t.name, status: t.status, version: t.version, visibility: t.visibility, module: t.module, isDefault: t.isDefault });

function assertScope(ctx: AccessContext, brandId: string | null, visibility: RtVisibility) {
  if (brandId && !ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (visibility === "PUBLIC_GROUP") {
    if (!ctx.isAdmin) throw new ForbiddenError("Public (group) templates are created by administrators");
    if (brandId) throw new BadRequestError("A public template belongs to all brands");
  } else if (visibility === "SHARED_BRAND") {
    if (!brandId) throw new BadRequestError("Choose the brand of the shared template");
    if (!isBrandAdmin(ctx, brandId) && !managedBrands(ctx).includes(brandId)) throw new ForbiddenError("Shared templates are created by the brand's manager, its Brand Admin or an administrator");
  }
}

export async function createRecordTemplate(ctx: AccessContext, meta: z.input<typeof metaSchema>, body: RecordTemplateBody) {
  const m = metaSchema.parse(meta);
  const mod = rtModule(m.module)!;
  assertCan(ctx, mod.permission, "create");
  assertScope(ctx, m.brandId, m.visibility);
  const data = await validate(ctx, mod, m.brandId, body);
  const t = await store.createRecordTemplate({ ...m, name: data.name, description: data.description ?? null, fieldValues: data.fieldValues as object, lockedFields: data.lockedFields, hiddenFields: data.hiddenFields, lineItems: data.lineItems, childRecords: data.childRecords, emailTemplateId: data.emailTemplateId || null, documentTemplateId: data.documentTemplateId || null, createdById: ctx.userId });
  await store.addRecordTemplateVersion(t.id, 1, data as object, ctx.userId);
  await audit({ ctx, action: "CREATE", entity: "RecordTemplate", entityId: t.id, brandId: t.brandId, after: { ...snapshot(t), fields: Object.keys(data.fieldValues) } });
  return { id: t.id };
}

async function loadEditable(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  if (!canEdit(ctx, t)) throw new ForbiddenError("You cannot change this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("The template is waiting for approval");
  return t;
}

/** Saves the template as a new version. A shared template changed by someone who cannot publish goes back to draft. */
export async function saveRecordTemplate(ctx: AccessContext, id: string, body: RecordTemplateBody) {
  const t = await loadEditable(ctx, id);
  if (t.status === "ARCHIVED") throw new BadRequestError("Restore the template before changing it");
  const data = await validate(ctx, rtModule(t.module)!, t.brandId, body);
  const version = t.version + 1;
  const status = t.status === "PUBLISHED" && !canPublish(ctx, t) ? "DRAFT" : t.status;
  await store.updateRecordTemplate(id, { name: data.name, description: data.description ?? null, fieldValues: data.fieldValues as object, lockedFields: data.lockedFields, hiddenFields: data.hiddenFields, lineItems: data.lineItems, childRecords: data.childRecords, emailTemplateId: data.emailTemplateId || null, documentTemplateId: data.documentTemplateId || null, version, status });
  await store.addRecordTemplateVersion(id, version, data as object, ctx.userId);
  await audit({ ctx, action: "UPDATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), name: data.name, version, status, fields: Object.keys(data.fieldValues) } });
  return { version, status };
}

export async function publishRecordTemplate(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t)) throw new ForbiddenError(t.visibility === "SHARED_BRAND" ? "Shared templates are published by the brand's Brand Admin or an administrator – submit it for approval" : "You cannot publish this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Decide the approval request instead (Approvals)");
  if (t.status === "PUBLISHED") throw new BadRequestError("The template is already published");
  await store.updateRecordTemplate(id, { status: "PUBLISHED" });
  await audit({ ctx, action: "UPDATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), status: "PUBLISHED" } });
}

export async function submitRecordTemplate(ctx: AccessContext, id: string) {
  const t = await loadEditable(ctx, id);
  if (canPublish(ctx, t)) throw new BadRequestError("You can publish this template yourself");
  if (t.visibility !== "SHARED_BRAND" || !t.brandId) throw new BadRequestError("Only shared brand templates need approval");
  if (t.status !== "DRAFT") throw new BadRequestError("Only a draft can be submitted");
  const regionId = ctx.memberships.find((m) => m.brandId === t.brandId && m.regionId)?.regionId ?? (await defaultInboundRegion());
  if (!regionId) throw new BadRequestError("No region is available for this brand");
  await store.updateRecordTemplate(id, { status: "PENDING_APPROVAL" });
  try {
    const { submitForApproval } = await import("@/server/modules/approvals/service");
    const outcome = await submitForApproval(ctx, { processKey: "RECORD_TEMPLATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, regionId, title: `Record template "${t.name}" (${rtModule(t.module)!.plural})`, summary: `Version ${t.version}` });
    await audit({ ctx, action: "UPDATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: snapshot(t), after: { ...snapshot(t), status: outcome.status === "APPROVED" ? "PUBLISHED" : "PENDING_APPROVAL", approvalRequestId: outcome.requestId } });
    return { status: outcome.status };
  } catch (err) {
    await store.updateRecordTemplate(id, { status: t.status });
    throw err;
  }
}

export async function setDefaultRecordTemplate(ctx: AccessContext, id: string, on: boolean) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t) || t.visibility === "PERSONAL") throw new ForbiddenError("The default template of a brand is set by its Brand Admin or an administrator");
  if (on && t.status !== "PUBLISHED") throw new BadRequestError("Publish the template before making it the default");
  await store.setDefaultRecordTemplate(id, t.module, t.brandId, on);
  await audit({ ctx, action: "UPDATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: { isDefault: t.isDefault }, after: { isDefault: on } });
}

export async function archiveRecordTemplate(ctx: AccessContext, id: string, archived: boolean) {
  const t = await loadSeen(ctx, id);
  if (!canPublish(ctx, t)) throw new ForbiddenError("You cannot archive this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Decide the approval request first");
  const status = archived ? "ARCHIVED" : "DRAFT";
  await store.updateRecordTemplate(id, { status, ...(archived ? { isDefault: false } : {}) });
  await audit({ ctx, action: "UPDATE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: { status: t.status }, after: { status } });
}

/** Deletes a template. One that records were created from is kept for reporting: archive it instead. */
export async function deleteRecordTemplate(ctx: AccessContext, id: string) {
  const t = await loadSeen(ctx, id);
  if (!(t.status === "PUBLISHED" ? canPublish(ctx, t) : canEdit(ctx, t))) throw new ForbiddenError("You cannot delete this template");
  if (t.status === "PENDING_APPROVAL") throw new BadRequestError("Recall the approval request first");
  if (t.usageCount > 0) throw new BadRequestError(`${t.usageCount} record(s) were created from this template – archive it instead`);
  await store.deleteRecordTemplate(id);
  await store.forgetTemplate("record", id);
  await audit({ ctx, action: "DELETE", entity: "RecordTemplate", entityId: id, brandId: t.brandId, before: snapshot(t) });
}

export async function cloneRecordTemplate(ctx: AccessContext, id: string) {
  const t = await getRecordTemplate(ctx, id);
  // the copy is the user's own: personal, in the same brand when they belong to it
  return createRecordTemplate(ctx, { module: t.module, brandId: t.brandId && ctx.brandIds.includes(t.brandId) ? t.brandId : null, visibility: "PERSONAL" }, { name: `${t.name} (copy)`.slice(0, 100), description: t.description, fieldValues: t.fieldValues, lockedFields: t.lockedFields, hiddenFields: t.hiddenFields, lineItems: t.lineItems, childRecords: t.childRecords as never, emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId });
}

export async function restoreRecordTemplateVersion(ctx: AccessContext, id: string, version: number) {
  await loadEditable(ctx, id);
  const v = await store.recordTemplateVersion(id, version);
  if (!v) throw new NotFoundError();
  return saveRecordTemplate(ctx, id, v.snapshot as RecordTemplateBody);
}

/**
 * "Save record as template": the values of an existing record the user can open, without what identifies one
 * customer or one record (names, phone, e-mail, VIN, numbers, links to other records) and without its owner.
 */
export async function saveRecordAsTemplate(ctx: AccessContext, moduleKey: string, recordId: string, name: string) {
  const mod = rtModule(moduleKey);
  if (!mod || mod.document) throw new BadRequestError("Records of this module cannot be saved as a template");
  assertCan(ctx, mod.permission, "create");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic delegate access; the scoped client hides other brands' records
  const row = (await (scopedDb(ctx) as any)[mod.delegate].findUnique({ where: { id: recordId } })) as Record<string, unknown> | null;
  if (!row) throw new NotFoundError();
  const { fieldMaskView } = await import("@/server/access/field-mask");
  const visible = fieldMaskView(ctx, mod.permission, row) as Record<string, unknown>;
  const values: Record<string, FieldValue> = {};
  for (const f of await templateFields(mod)) {
    const v = visible[f.name];
    if (mod.personal.includes(f.name) || ["ownerId", "brandId", "status"].includes(f.name) || v === null || v === undefined || v === "") continue;
    if (f.type === "date") continue; // a date of one record is not a default for the next
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") values[f.name] = v;
    else if (typeof (v as { toNumber?: unknown }).toNumber === "function") values[f.name] = (v as { toNumber: () => number }).toNumber();
  }
  const brandId = typeof row.brandId === "string" ? row.brandId : null;
  return createRecordTemplate(ctx, { module: mod.key, brandId, visibility: "PERSONAL" }, { name: name.trim() || `${mod.label} template`, fieldValues: values });
}

// ───────────────────────────── use ─────────────────────────────

export interface TemplateRef {
  templateId: string;
  version: number;
  name: string;
  module: string;
  children: Body["childRecords"];
  emailTemplateId: string | null;
  documentTemplateId: string | null;
}

function resolveValue(ctx: AccessContext, v: FieldValue, brandId: string | null): unknown {
  if (!isFormula(v)) return v;
  if (v.$ === "currentUser") return ctx.userId;
  if (v.$ === "userRegion") return ctx.memberships.find((m) => (!brandId || m.brandId === brandId) && m.regionId)?.regionId ?? ctx.memberships.find((m) => m.regionId)?.regionId ?? "";
  const days = Number(/^today([+-]\d+)d$/.exec(v.$)?.[1] ?? 0);
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A published template the user may use, with its formulas resolved for them – what the create form pre-fills. */
export async function resolveForUse(ctx: AccessContext, id: string, moduleKey?: string) {
  const t = (await store.recordTemplates({ id }))[0];
  if (!t || !usable(ctx, t) || (moduleKey && t.module !== moduleKey)) throw new NotFoundError();
  const raw = (t.fieldValues ?? {}) as Record<string, FieldValue>;
  const brandId = t.brandId ?? (typeof raw.brandId === "string" ? raw.brandId : null);
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) values[k] = resolveValue(ctx, v, brandId);
  if (t.brandId) values.brandId = t.brandId;
  const locked = [...((t.lockedFields ?? []) as string[]), ...(t.brandId ? ["brandId"] : [])];
  return { id: t.id, name: t.name, description: t.description, module: t.module, version: t.version, brandId: t.brandId, values, locked: [...new Set(locked)], hidden: (t.hiddenFields ?? []) as string[], lineItems: (t.lineItems ?? []) as Body["lineItems"], children: (t.childRecords ?? []) as Body["childRecords"], emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId };
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * Called by every create action / API of a module before its create service.
 *  - without a template: refuses when the module requires one (Setup → Record template policy);
 *  - with a template: locked and hidden fields take the template's value whatever was posted, other fields keep what
 *    the user entered and fall back to the template; the template's brand is the record's brand.
 * The create service then validates everything as for any other record.
 */
export async function applyTemplate<T extends Record<string, unknown>>(ctx: AccessContext, moduleKey: string, templateId: string | null | undefined, input: T): Promise<{ input: T; ref: TemplateRef | null }> {
  if (!templateId) {
    const policy = (await getSetting("recordTemplatePolicy")) as Record<string, boolean>;
    if (policy[moduleKey]) throw new ForbiddenError(`${rtModule(moduleKey)?.plural ?? "Records"} are created from a template – choose one under “Create from template”`);
    return { input, ref: null };
  }
  const t = await resolveForUse(ctx, templateId, moduleKey);
  const merged: Record<string, unknown> = { ...input };
  const forced = new Set([...t.locked, ...t.hidden]);
  for (const [k, v] of Object.entries(t.values)) if (forced.has(k) || blank(merged[k])) merged[k] = v;
  // "all my brands": the record's brand is the user's choice – among THEIR brands (the create service checks the rest)
  if (!t.brandId && typeof merged.brandId === "string" && merged.brandId && !ctx.brandIds.includes(merged.brandId)) throw new NotFoundError();
  return { input: merged as T, ref: { templateId: t.id, version: t.version, name: t.name, module: t.module, children: t.children, emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId } };
}

/** After the record exists: remember the template and version, create the template's tasks. Returns where to go next. */
export async function afterCreate(ctx: AccessContext, ref: TemplateRef | null, recordId: string): Promise<{ tasks: number; next: string | null }> {
  if (!ref) return { tasks: 0, next: null };
  const mod = rtModule(ref.module)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic delegate access (the record was just created by this user)
  const row = (await (scopedDb(ctx) as any)[mod.delegate].findUnique({ where: { id: recordId } })) as { brandId?: string | null } | null;
  const brandId = typeof row?.brandId === "string" ? row.brandId : null;
  await store.recordUse({ templateId: ref.templateId, templateVersion: ref.version, module: ref.module, recordId, brandId, userId: ctx.userId });
  let tasks = 0;
  if (mod.parentType && ref.children.length && hasPermission(ctx, "activities", "create")) {
    const { createActivity } = await import("@/server/modules/activities/service");
    for (const c of ref.children) {
      // shared customers have no brand of their own: the task is in the user's first brand
      const scope = brandId ? {} : { brandId: ctx.brandIds[0], regionId: ctx.memberships.find((m) => m.brandId === ctx.brandIds[0] && m.regionId)?.regionId };
      await createActivity(ctx, { type: c.type, parentType: mod.parentType, parentId: recordId, subject: c.subject, dueAt: new Date(Date.now() + c.dueInHours * 3_600_000).toISOString(), priority: c.priority, description: `From the template "${ref.name}"`, ...scope } as never)
        .then(() => tasks++)
        .catch(() => undefined); // a task that cannot be created does not undo the record
    }
  }
  await audit({ ctx, action: "CREATE", entity: "RecordTemplateUse", entityId: recordId, brandId, after: { templateId: ref.templateId, version: ref.version, module: ref.module, tasks } });
  // the optional e-mail / document of the template: the composer opens for the user to review and send
  const parent = { leads: "Lead", deals: "Deal", cases: "Case", contacts: "Contact", accounts: "Account", quotes: "Quote", salesOrders: "SalesOrder", invoices: "Invoice" }[ref.module];
  const next = parent && (ref.emailTemplateId || ref.documentTemplateId) ? `/email/compose?type=${parent}&id=${recordId}${ref.emailTemplateId ? `&tpl=${ref.emailTemplateId}` : ""}${ref.documentTemplateId ? `&doc=${encodeURIComponent(`doc:${ref.documentTemplateId}`)}` : ""}` : null;
  return { tasks, next };
}

/**
 * The one way a module's create action or API creates a record: template applied (or the "template required" rule
 * checked), the module's own create service called, the template remembered.
 */
export async function createWithTemplate<I extends Record<string, unknown>, R extends { id: string }>(ctx: AccessContext, moduleKey: string, templateId: string | null | undefined, input: I, create: (input: I) => Promise<R>): Promise<{ record: R; tasks: number; next: string | null; templateName: string | null }> {
  const applied = await applyTemplate(ctx, moduleKey, templateId, input);
  const record = await create(applied.input);
  const after = await afterCreate(ctx, applied.ref, record.id);
  return { record, ...after, templateName: applied.ref?.name ?? null };
}

/**
 * Creates a record from a template in one call (API, quick create, quotes). `overrides` are the values the caller
 * adds (a name, a customer, the deal of a quote); locked and hidden fields cannot be overridden.
 */
export async function createFromTemplate(ctx: AccessContext, moduleKey: string, templateId: string, overrides: Record<string, unknown> = {}) {
  const mod = rtModule(moduleKey);
  if (!mod) throw new NotFoundError();
  assertCan(ctx, mod.permission, "create");
  if (mod.document) return createDocumentFromTemplate(ctx, mod.key, mod.document, templateId, overrides);
  const { input, ref } = await applyTemplate(ctx, mod.key, templateId, overrides);
  const record = await mod.create(ctx, input);
  const after = await afterCreate(ctx, ref, record.id);
  return { id: record.id, href: mod.recordHref(record.id), templateId: ref!.templateId, templateVersion: ref!.version, ...after };
}

/**
 * A quote, sales order or invoice from a template: the template's line items priced from the CURRENT price book,
 * terms, notes and dates. Standalone it needs the customer (`billTo`); a quote for a deal (`dealId` only) takes the
 * customer from the deal as before.
 */
async function createDocumentFromTemplate(ctx: AccessContext, moduleKey: string, type: "quote" | "salesOrder" | "invoice", templateId: string, overrides: Record<string, unknown>) {
  const dealId = typeof overrides.dealId === "string" ? overrides.dealId : "";
  if (type !== "quote" || !dealId || overrides.billTo) {
    const t = await resolveForUse(ctx, templateId, moduleKey);
    if (!overrides.billTo) throw new BadRequestError("Give the customer: billTo with at least a name (or a dealId for a quotation)");
    const products = t.lineItems.length ? await scopedDb(ctx).product.findMany({ where: { id: { in: t.lineItems.map((l) => l.productId) } }, select: { id: true, name: true } }) : [];
    const lines = Array.isArray(overrides.lines) && overrides.lines.length ? overrides.lines : t.lineItems.filter((l) => products.some((p) => p.id === l.productId)).map((l) => ({ productId: l.productId, description: products.find((p) => p.id === l.productId)!.name, qty: l.qty, discountPct: l.discountPct }));
    const rest: Record<string, unknown> = { ...overrides };
    const { createDocument } = await import("@/server/modules/documents/service");
    const created = await createDocument(ctx, type, { ...t.values, ...rest, brandId: t.brandId ?? rest.brandId, lines } as never);
    const ref: TemplateRef = { templateId: t.id, version: t.version, name: t.name, module: moduleKey, children: [], emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId };
    const after = await afterCreate(ctx, ref, created.id);
    return { id: created.id, href: `${rtModule(moduleKey)!.newHref.replace(/\/new$/, "")}/${created.id}`, templateId: t.id, templateVersion: t.version, ...after };
  }
  const t = await resolveForUse(ctx, templateId, "quotes");
  const docs = await import("@/server/modules/documents/service");
  const { getDocument } = await import("@/server/modules/documents/queries");
  const { getPrice } = await import("@/server/modules/catalogue/queries");
  const quote = await docs.createQuoteFromDeal(ctx, dealId);
  const doc = await getDocument(ctx, "quote", quote.id);
  if (t.brandId && doc.brandId !== t.brandId) {
    await scopedDb(ctx).quote.delete({ where: { id: quote.id } }).catch(() => undefined);
    throw new BadRequestError("This template belongs to another brand than the deal");
  }
  const lines = [];
  for (const l of t.lineItems) {
    const product = await scopedDb(ctx).product.findUnique({ where: { id: l.productId }, select: { id: true, name: true, brandId: true } });
    if (!product || product.brandId !== doc.brandId) continue; // a product of another brand is never put on the quote
    const price = await getPrice(ctx, product.id, new Date(), doc.priceBookId);
    lines.push({ productId: product.id, description: product.name, qty: l.qty, unitPrice: price.price ?? 0, discountPct: l.discountPct, taxRate: price.taxRatePct });
  }
  const str = (k: string) => (typeof t.values[k] === "string" && t.values[k] ? (t.values[k] as string) : undefined);
  if (lines.length || str("terms") || str("notes") || str("validUntil")) {
    await docs.saveDocument(ctx, "quote", quote.id, { lines: lines.length ? lines : doc.lines.map((l) => ({ productId: l.productId, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxRate: Number(l.taxRate), vin: l.vin })), terms: str("terms") ?? doc.terms ?? undefined, notes: str("notes") ?? doc.notes ?? undefined, date: str("validUntil") ?? undefined, headerDiscountPct: typeof t.values.headerDiscountPct === "number" ? t.values.headerDiscountPct : undefined } as never);
  }
  const ref: TemplateRef = { templateId: t.id, version: t.version, name: t.name, module: "quotes", children: [], emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId };
  const after = await afterCreate(ctx, ref, quote.id);
  return { id: quote.id, href: `/quotes/${quote.id}`, templateId: t.id, templateVersion: t.version, ...after };
}

/** The template a record was created from (shown on reports and in the API). */
export async function templateOfRecord(ctx: AccessContext, moduleKey: string, recordId: string) {
  const mod = rtModule(moduleKey);
  if (!mod) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic delegate access; hidden records give null
  if (!(await (scopedDb(ctx) as any)[mod.delegate].findUnique({ where: { id: recordId }, select: { id: true } }))) throw new NotFoundError();
  const use = await store.useOfRecord(moduleKey, recordId);
  return use ? { createdFromTemplateId: use.templateId, createdFromTemplateVersion: use.templateVersion, templateName: use.template.name } : null;
}

export async function templateBrandOptions(ctx: AccessContext) {
  const { brandLetterheadRows } = await import("@/server/db/print-store");
  const brands = (await brandLetterheadRows(ctx.brandIds)).filter((b) => b.status !== "INACTIVE").sort((a, b) => a.code.localeCompare(b.code)).map((b) => ({ id: b.id, label: `${b.code} – ${b.name}`, shared: isBrandAdmin(ctx, b.id) || managedBrands(ctx).includes(b.id) }));
  return { brands, group: !!ctx.isAdmin };
}

export { RT_MODULES, type TemplateField };

/** What the record template editor offers besides the fields: the brand's products, e-mail and document templates. */
export async function editorLookups(ctx: AccessContext, moduleKey: string, brandId: string | null) {
  const mod = rtModule(moduleKey);
  if (!mod) throw new NotFoundError();
  const db = scopedDb(ctx);
  const brands = brandId ? [brandId] : ctx.brandIds;
  const doc = await import("@/server/modules/doctpl/service");
  const [products, emailTemplates, documentTemplates] = await Promise.all([
    mod.hasLines && brandId && hasPermission(ctx, "products", "read") ? db.product.findMany({ where: { brandId, active: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    db.template.findMany({ where: { channel: "EMAIL", active: true, AND: [{ OR: [{ brandId: null }, { brandId: { in: brands } }] }, { OR: [{ module: null }, { module: mod.key }] }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    doc.listTemplates(ctx, { module: mod.key, status: "PUBLISHED" }),
  ]);
  return {
    fields: (await templateFields(mod)).filter((f) => !mod.personal.includes(f.name) && f.name !== "brandId"),
    products: products.map((p) => ({ id: p.id, label: p.code ? `${p.code} – ${p.name}` : p.name })),
    emailTemplates,
    documentTemplates: documentTemplates.filter((t) => t.visibility !== "PERSONAL" && (!t.brandId || !brandId || t.brandId === brandId)).map((t) => ({ id: t.id, name: t.name })),
    hasLines: !!mod.hasLines,
    hasChildren: !!mod.parentType,
    label: mod.label,
    plural: mod.plural,
  };
}
