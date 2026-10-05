/**
 * Templates hub (prompt 22): ONE list over the template types that already exist – message templates (e-mail, SMS,
 * WhatsApp; prompts 10 / 20), document templates (prompt 21), print templates (prompt 20) and record templates
 * (prompt 22) – with views, folders, favourites, filters and the row actions.
 *
 * The hub adds no access of its own. Every row comes from its own service or brand filter (a template of a brand the
 * user is not in is never read), and every action is carried out by the service of that template type with its
 * rules. What the hub owns: favourites (per user), folders and "where is it used".
 */
import "server-only";
import { managedBrands } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { getModule, type ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import * as store from "@/server/db/template-hub-store";
import { BadRequestError } from "@/server/errors";
import * as doc from "@/server/modules/doctpl/service";
import { canEditTemplate } from "@/server/modules/email/templates";
import { PRINT_MODULES } from "@/server/modules/print/modules";
import { RT_MODULES } from "@/server/modules/rectpl/modules";
import * as rec from "@/server/modules/rectpl/service";

export const HUB_KINDS = ["email", "sms", "whatsapp", "document", "print", "record"] as const;
export type HubKind = (typeof HUB_KINDS)[number];
export const HUB_TABS = [
  { key: "email", label: "Email", kinds: ["email"] },
  { key: "document", label: "Document / Print", kinds: ["document", "print"] },
  { key: "record", label: "Record", kinds: ["record"] },
  { key: "sms", label: "SMS", kinds: ["sms"] },
  { key: "whatsapp", label: "WhatsApp", kinds: ["whatsapp"] },
] as const;
export type HubTab = (typeof HUB_TABS)[number]["key"];
export const HUB_VIEWS = [
  { key: "all", label: "All Templates" },
  { key: "favorites", label: "Favorites" },
  { key: "associated", label: "Associated Templates" },
  { key: "mine", label: "Created by me" },
  { key: "shared", label: "Shared with me" },
  { key: "public", label: "Public Templates" },
] as const;
export type HubView = (typeof HUB_VIEWS)[number]["key"];
export const KIND_LABELS: Record<HubKind, string> = { email: "E-mail", sms: "SMS", whatsapp: "WhatsApp", document: "Document", print: "Print layout", record: "Record" };

export interface HubItem {
  kind: HubKind;
  id: string;
  name: string;
  /** subject or description – searched together with the name */
  detail: string;
  module: string | null;
  moduleLabel: string;
  brandId: string | null;
  brandCode: string | null;
  status: "Draft" | "Pending approval" | "Published" | "Archived" | "Inactive";
  scope: "Personal" | "Shared" | "Public";
  ownerId: string | null;
  ownerName: string;
  mine: boolean;
  updatedAt: Date;
  usageCount: number;
  isDefault: boolean;
  favorite: boolean;
  folderId: string | null;
  /** where the template is used: "Campaign: …", "Workflow rule: …", "Record template: …" */
  associated: string[];
  /** editor / detail page; null when the user can use the template but has no page for it */
  href: string | null;
  editable: boolean;
  cloneable: boolean;
  canDefault: boolean;
  canArchive: boolean;
}

// ───────────────────────────── modules per template type ─────────────────────────────

/** The order of the "Select Module" list (prompt 22 §2). Activities cover tasks, meetings, calls and test drives. */
const ORDER = ["leads", "contacts", "accounts", "deals", "activities", "products", "quotes", "salesOrders", "inventoryDocuments", "invoices", "campaigns", "priceBooks", "cases", "vehicleUnits"];
const EMAIL_MODULES = ["leads", "contacts", "accounts", "deals", "quotes", "salesOrders", "invoices", "cases"];
const TEXT_MODULES = ["leads", "deals", "cases"];
const permissionOf = (key: string): ModuleKey => PRINT_MODULES.find((m) => m.key === key)?.permission ?? (key as ModuleKey);
const labelOf = (key: string | null) => (key ? (PRINT_MODULES.find((m) => m.key === key)?.plural ?? getModule(key)?.label ?? key) : "Any module");

/** Modules offered by "New Template → Select Module" for a template type: only what the user can read. */
export function modulesFor(ctx: AccessContext, tab: HubTab): Array<{ key: string; label: string }> {
  const keys = tab === "email" ? EMAIL_MODULES : tab === "document" ? PRINT_MODULES.map((m) => m.key) : tab === "record" ? RT_MODULES.map((m) => m.key) : TEXT_MODULES;
  return ORDER.filter((k) => keys.includes(k) && hasPermission(ctx, permissionOf(k), "read")).map((k) => ({ key: k, label: labelOf(k) }));
}

// ───────────────────────────── the list ─────────────────────────────

const CHANNEL_KIND: Record<string, HubKind> = { EMAIL: "email", SMS: "sms", WHATSAPP: "whatsapp" };
const DOC_STATUS: Record<string, HubItem["status"]> = { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", PUBLISHED: "Published", ARCHIVED: "Archived" };

async function allItems(ctx: AccessContext): Promise<HubItem[]> {
  const [messages, docs, prints, records, favs, allPlaces, assoc, folderRows] = await Promise.all([
    store.messageTemplates(ctx.brandIds),
    doc.listTemplates(ctx),
    store.printTemplatesOf(ctx.brandIds),
    rec.listRecordTemplates(ctx),
    store.favorites(ctx.userId),
    store.placements(ctx.userId),
    store.associations(),
    store.folders(ctx.userId, ctx.brandIds),
  ]);
  // only places in folders the user can see count (a brand's shared folder does not exist for other brands)
  const visibleFolders = new Set(folderRows.map((f) => f.id));
  const places = allPlaces.filter((p) => visibleFolders.has(p.folderId));
  const [usage, names] = await Promise.all([store.messageTemplateUsage(messages.map((m) => m.id)), store.userNames(messages.map((m) => m.createdById ?? ""))]);
  const fav = new Set(favs.map((f) => `${f.kind}:${f.templateId}`));
  // a personal placement comes before a shared one
  const folderOf = (kind: string, id: string) => (places.find((p) => p.kind === kind && p.templateId === id && p.scope === ctx.userId) ?? places.find((p) => p.kind === kind && p.templateId === id && p.scope === ""))?.folderId ?? null;
  const usedBy = (id: string, needle = id) => [
    ...assoc.campaigns.filter((c) => c.templateId === id && (!c.brandId || ctx.brandIds.includes(c.brandId))).map((c) => `Campaign: ${c.name}`),
    ...assoc.rules.filter((r) => r.actions.includes(needle)).map((r) => `Workflow rule: ${r.name}`),
    ...records.filter((r) => r.emailTemplateId === id || r.documentTemplateId === id).map((r) => `Record template: ${r.name}`),
  ];
  const canSetup = !!ctx.isAdmin || (ctx.brandAdminOf?.length ?? 0) > 0;
  const base = (kind: HubKind, id: string) => ({ kind, id, favorite: fav.has(`${kind}:${id}`), folderId: folderOf(kind, id) });

  const items: HubItem[] = [];
  for (const t of messages) {
    const kind = CHANNEL_KIND[t.channel] ?? "email";
    const editable = kind === "email" ? canEditTemplate(ctx, t.brandId) : (await import("@/server/modules/messaging/campaigns")).canManageTemplate(ctx, t.brandId);
    items.push({ ...base(kind, t.id), name: t.name, detail: `${t.subject ?? ""} ${t.body}`.slice(0, 400), module: t.module, moduleLabel: labelOf(t.module), brandId: t.brandId, brandCode: t.brand?.code ?? null, status: t.active ? "Published" : "Inactive", scope: t.brandId ? "Shared" : "Public", ownerId: t.createdById, ownerName: names.get(t.createdById ?? "") ?? "", mine: t.createdById === ctx.userId, updatedAt: t.updatedAt, usageCount: usage.get(t.id) ?? 0, isDefault: false, associated: usedBy(t.id), href: hasPermission(ctx, "campaigns", "read") ? (kind === "email" ? `/campaigns/templates/email/${t.id}` : editable ? `/campaigns/templates?edit=${t.id}` : "/campaigns/templates") : null, editable, cloneable: editable, canDefault: false, canArchive: editable });
  }
  for (const t of docs) {
    items.push({ ...base("document", t.id), name: t.name, detail: "", module: t.module, moduleLabel: labelOf(t.module), brandId: t.brandId, brandCode: t.brandCode, status: DOC_STATUS[t.status] ?? "Draft", scope: t.visibility === "PERSONAL" ? "Personal" : t.visibility === "GROUP" ? "Public" : "Shared", ownerId: t.ownerId, ownerName: t.ownerName, mine: t.mine, updatedAt: t.updatedAt, usageCount: t.usageCount, isDefault: t.isDefault, associated: usedBy(t.id, `doc:${t.id}`), href: `/templates/documents/${t.id}`, editable: t.editable, cloneable: true, canDefault: t.publishable && t.visibility !== "PERSONAL" && t.status === "PUBLISHED", canArchive: t.publishable && t.status !== "PENDING_APPROVAL" });
  }
  for (const t of prints.filter((p) => p.active || canSetup)) {
    const mine = canSetup && (t.brandId === null ? !!ctx.isAdmin : !!ctx.isAdmin || !!ctx.brandAdminOf?.includes(t.brandId));
    items.push({ ...base("print", t.id), name: t.name, detail: "", module: t.module, moduleLabel: labelOf(t.module), brandId: t.brandId, brandCode: t.brand?.code ?? null, status: t.active ? "Published" : "Inactive", scope: t.brandId ? "Shared" : "Public", ownerId: t.createdById, ownerName: "", mine: t.createdById === ctx.userId, updatedAt: t.updatedAt, usageCount: 0, isDefault: t.isDefault, associated: [], href: mine ? `/setup/print-templates/${t.id}` : null, editable: mine, cloneable: false, canDefault: false, canArchive: false });
  }
  for (const t of records) {
    items.push({ ...base("record", t.id), name: t.name, detail: t.description ?? "", module: t.module, moduleLabel: t.moduleLabel, brandId: t.brandId, brandCode: t.brandCode, status: DOC_STATUS[t.status] ?? "Draft", scope: t.visibility === "PERSONAL" ? "Personal" : t.visibility === "PUBLIC_GROUP" ? "Public" : "Shared", ownerId: t.ownerId, ownerName: t.ownerName, mine: t.mine, updatedAt: t.updatedAt, usageCount: t.usageCount, isDefault: t.isDefault, associated: [], href: `/templates/records/${t.id}`, editable: t.editable, cloneable: true, canDefault: t.publishable && t.visibility !== "PERSONAL" && t.status === "PUBLISHED", canArchive: t.publishable && t.status !== "PENDING_APPROVAL" });
  }
  return items;
}

export interface HubQuery {
  tab?: string | null;
  view?: string | null;
  module?: string | null;
  brand?: string | null;
  folder?: string | null;
  status?: string | null;
  owner?: string | null;
  q?: string | null;
  sort?: string | null;
}

const inView = (i: HubItem, view: HubView) => (view === "favorites" ? i.favorite : view === "associated" ? i.associated.length > 0 : view === "mine" ? i.mine : view === "shared" ? !i.mine && i.scope === "Shared" : view === "public" ? i.scope === "Public" : true);

/** The hub page: the rows of a tab and view after the filters, the counts of the views, and the folders. */
export async function hubList(ctx: AccessContext, q: HubQuery = {}) {
  const tab = (HUB_TABS.find((t) => t.key === q.tab) ?? HUB_TABS[0]).key;
  const view = (HUB_VIEWS.find((v) => v.key === q.view) ?? HUB_VIEWS[0]).key;
  const kinds = HUB_TABS.find((t) => t.key === tab)!.kinds as readonly string[];
  const [all, folderRows] = await Promise.all([allItems(ctx), store.folders(ctx.userId, ctx.brandIds)]);
  const ofTab = all.filter((i) => kinds.includes(i.kind));
  const text = (q.q ?? "").trim().toLowerCase();
  const folderIds = new Set(folderRows.map((f) => f.id));
  let rows = ofTab.filter((i) => inView(i, view));
  if (q.module) rows = rows.filter((i) => i.module === q.module);
  if (q.brand) rows = rows.filter((i) => (q.brand === "all" ? i.brandId === null : i.brandId === q.brand));
  if (q.folder && folderIds.has(q.folder)) rows = rows.filter((i) => i.folderId === q.folder);
  if (q.status) rows = rows.filter((i) => i.status === q.status);
  if (q.owner === "me") rows = rows.filter((i) => i.mine);
  if (text) rows = rows.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(text));
  const sort = q.sort === "name" || q.sort === "used" ? q.sort : "updated";
  rows.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "used" ? b.usageCount - a.usageCount || a.name.localeCompare(b.name) : b.updatedAt.getTime() - a.updatedAt.getTime()));
  return {
    tab,
    view,
    sort,
    rows,
    tabCounts: Object.fromEntries(HUB_TABS.map((t) => [t.key, all.filter((i) => (t.kinds as readonly string[]).includes(i.kind)).length])) as Record<HubTab, number>,
    viewCounts: Object.fromEntries(HUB_VIEWS.map((v) => [v.key, ofTab.filter((i) => inView(i, v.key)).length])) as Record<HubView, number>,
    folders: folderRows.map((f) => ({ id: f.id, name: f.name, shared: f.shared, brandCode: f.brand?.code ?? null, mine: f.ownerId === ctx.userId, count: ofTab.filter((i) => i.folderId === f.id).length, manageable: canManageFolder(ctx, f) })),
    modules: modulesFor(ctx, tab),
    statuses: [...new Set(ofTab.map((i) => i.status))].sort(),
  };
}

/** One template as the user sees it in the hub – or 404. Every hub action starts here. */
async function findItem(ctx: AccessContext, kind: string, id: string): Promise<HubItem> {
  if (!(HUB_KINDS as readonly string[]).includes(kind)) throw new NotFoundError();
  const item = (await allItems(ctx)).find((i) => i.kind === kind && i.id === id);
  if (!item) throw new NotFoundError();
  return item;
}

/** API: templates of a type (and module) the caller can see. */
export async function hubApiList(ctx: AccessContext, type: string | null, moduleKey: string | null) {
  const kinds: readonly string[] = type === "document" ? ["document", "print"] : type && (HUB_KINDS as readonly string[]).includes(type) ? [type] : HUB_KINDS;
  return (await allItems(ctx))
    .filter((i) => kinds.includes(i.kind) && (!moduleKey || i.module === moduleKey))
    .map((i) => ({ type: i.kind, id: i.id, name: i.name, module: i.module, brand: i.brandCode, status: i.status, scope: i.scope, owner: i.ownerName, isDefault: i.isDefault, usageCount: i.usageCount, updatedAt: i.updatedAt, associated: i.associated }));
}

// ───────────────────────────── favourites and folders ─────────────────────────────

export async function setFavorite(ctx: AccessContext, kind: string, id: string, on: boolean) {
  const item = await findItem(ctx, kind, id);
  await store.setFavorite(ctx.userId, item.kind, item.id, on);
}

type FolderRow = { ownerId: string; shared: boolean; brandId: string | null };
/** Personal folders: their owner. Shared brand folders: the brand's manager / Brand Admin / administrator. Group folders: administrators. */
function canManageFolder(ctx: AccessContext, f: FolderRow): boolean {
  if (!f.shared) return f.ownerId === ctx.userId;
  if (!f.brandId) return !!ctx.isAdmin;
  return ctx.brandIds.includes(f.brandId) && (!!ctx.isAdmin || !!ctx.brandAdminOf?.includes(f.brandId) || managedBrands(ctx).includes(f.brandId));
}

export async function createFolder(ctx: AccessContext, input: { name: string; shared: boolean; brandId: string | null }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new BadRequestError("A folder name has 2 to 60 characters");
  if (input.brandId && !ctx.brandIds.includes(input.brandId)) throw new NotFoundError();
  const row = { ownerId: ctx.userId, shared: input.shared, brandId: input.shared ? input.brandId : null };
  if (!canManageFolder(ctx, row)) throw new ForbiddenError(row.brandId ? "Shared folders of a brand are created by its manager, its Brand Admin or an administrator" : "Group folders are created by administrators");
  const f = await store.createFolder({ name, ...row });
  await audit({ ctx, action: "CREATE", entity: "TemplateFolder", entityId: f.id, brandId: f.brandId, after: { name, shared: f.shared } });
  return { id: f.id };
}

async function visibleFolder(ctx: AccessContext, id: string) {
  const f = await store.folder(id);
  if (!f || (f.shared ? !!f.brandId && !ctx.brandIds.includes(f.brandId) : f.ownerId !== ctx.userId)) throw new NotFoundError();
  return f;
}

export async function deleteFolder(ctx: AccessContext, id: string) {
  const f = await visibleFolder(ctx, id);
  if (!canManageFolder(ctx, f)) throw new ForbiddenError("You cannot remove this folder");
  await store.deleteFolder(id); // the templates stay; only their place in the folder goes
  await audit({ ctx, action: "DELETE", entity: "TemplateFolder", entityId: id, brandId: f.brandId, before: { name: f.name, shared: f.shared } });
}

/** Puts a template into a folder (or takes it out with folderId ""). A shared folder needs the right to manage it. */
export async function moveToFolder(ctx: AccessContext, kind: string, id: string, folderId: string) {
  const item = await findItem(ctx, kind, id);
  if (!folderId) {
    await store.unplace(item.kind, item.id, [ctx.userId, ...(item.editable ? [""] : [])]);
    return;
  }
  const f = await visibleFolder(ctx, folderId);
  if (f.shared) {
    if (!canManageFolder(ctx, f)) throw new ForbiddenError("Only people who manage this shared folder can put templates into it");
    // a brand's shared folder holds that brand's (and public) templates – never another brand's
    if (f.brandId && item.brandId && item.brandId !== f.brandId) throw new BadRequestError("This template belongs to another brand than the folder");
  }
  await store.place(item.kind, item.id, f.shared ? "" : ctx.userId, f.id);
}

// ───────────────────────────── row actions ─────────────────────────────

export async function cloneTemplate(ctx: AccessContext, kind: string, id: string): Promise<{ href: string }> {
  const item = await findItem(ctx, kind, id);
  if (item.kind === "record") return { href: `/templates/records/${(await rec.cloneRecordTemplate(ctx, id)).id}` };
  if (item.kind === "document") return { href: `/templates/documents/${(await doc.cloneTemplate(ctx, id)).id}` };
  if (item.kind === "email") {
    const email = await import("@/server/modules/email/templates");
    const t = await email.richTemplate(ctx, id);
    const copy = await email.saveRichTemplate(ctx, null, { brandId: t.brandId, name: `${t.name} (copy)`.slice(0, 120), module: t.module, folder: t.folder, category: (t.category ?? "Sales") as "Sales", subject: t.subject ?? t.name, doc: t.doc, active: false });
    return { href: `/campaigns/templates/email/${copy.id}` };
  }
  if (item.kind === "sms" || item.kind === "whatsapp") {
    const { scopedDb } = await import("@/server/db");
    const campaigns = await import("@/server/modules/messaging/campaigns");
    const t = await scopedDb(ctx).template.findUnique({ where: { id } });
    if (!t) throw new NotFoundError();
    const copy = await campaigns.saveTemplate(ctx, null, { brandId: t.brandId, channel: t.channel, name: `${t.name} (copy)`.slice(0, 120), subject: t.subject ?? "", body: t.body, whatsappStatus: "NOT_SUBMITTED", whatsappName: "", active: false });
    return { href: `/campaigns/templates?edit=${copy.id}` };
  }
  throw new BadRequestError("Print layouts are copied in the print template designer");
}

export async function setDefault(ctx: AccessContext, kind: string, id: string, on: boolean) {
  const item = await findItem(ctx, kind, id);
  if (item.kind === "document") return doc.setDefault(ctx, id, on);
  if (item.kind === "record") return rec.setDefaultRecordTemplate(ctx, id, on);
  throw new BadRequestError("Only document and record templates have a default per module and brand");
}

export async function archiveTemplate(ctx: AccessContext, kind: string, id: string, archived: boolean) {
  const item = await findItem(ctx, kind, id);
  if (item.kind === "document") return doc.archiveTemplate(ctx, id, archived);
  if (item.kind === "record") return rec.archiveRecordTemplate(ctx, id, archived);
  if (item.kind === "print") throw new BadRequestError("Print layouts are switched off in the print template designer");
  // message templates: archived = not active (no longer offered in the composer, workflows and campaigns)
  if (!item.editable) throw new ForbiddenError("You cannot change this template");
  const { unsafeSetTemplateActive } = await import("@/server/db/print-store");
  await unsafeSetTemplateActive(id, !archived);
  await audit({ ctx, action: "UPDATE", entity: "Template", entityId: id, brandId: item.brandId, before: { active: archived }, after: { active: !archived } });
}

/**
 * Deletes a template. One that is used by a campaign, a workflow rule or another template is NOT deleted: the error
 * lists where it is used (archive it instead). Only a Super Admin may delete it anyway.
 */
export async function deleteTemplate(ctx: AccessContext, kind: string, id: string) {
  const item = await findItem(ctx, kind, id);
  if (item.associated.length && !ctx.isSuperAdmin) throw new BadRequestError(`This template is in use and cannot be deleted – archive it instead. Used by: ${item.associated.slice(0, 8).join("; ")}`);
  if (item.kind === "document") await doc.deleteTemplate(ctx, id);
  else if (item.kind === "record") await rec.deleteRecordTemplate(ctx, id);
  else if (item.kind === "print") await (await import("@/server/modules/print/service")).deleteTemplate(ctx, id);
  else await (await import("@/server/modules/messaging/campaigns")).deleteTemplate(ctx, id);
  await store.forgetTemplate(item.kind, id);
}
