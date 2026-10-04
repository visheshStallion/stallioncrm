/**
 * Cases configuration (prompt 11): SLA policies per brand, the business calendar and the solutions knowledge
 * base. Brand items are managed by the brand's manager (or an administrator); group items by administrators
 * and management.
 */
import "server-only";
import type { CasePriority, Prisma } from "@prisma/client";
import { z } from "zod";
import { canManageBrandData } from "@/server/access/brand-tag";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { CASE_PRIORITIES, slaSchema, solutionSchema } from "./schema";

// ───────────────────────────── SLA policies ─────────────────────────────

export const canManageSla = (ctx: AccessContext, brandId: string) => ctx.isAdmin || canManageBrandData(ctx, "cases", "edit", brandId);

export async function listSlaPolicies(ctx: AccessContext) {
  assertCan(ctx, "cases", "read");
  const rows = await scopedDb(ctx).slaPolicy.findMany({ include: { brand: { select: { code: true, name: true, status: true } } }, orderBy: [{ brand: { code: "asc" } }] });
  const order = (p: string) => CASE_PRIORITIES.indexOf(p as never);
  return rows.filter((r) => r.brand.status !== "INACTIVE").sort((a, b) => a.brand.code.localeCompare(b.brand.code) || order(b.priority) - order(a.priority));
}

export async function saveSlaPolicy(ctx: AccessContext, brandId: string, priority: string, input: unknown) {
  if (!canManageSla(ctx, brandId)) throw new ForbiddenError("SLA policies are managed by the brand's manager");
  if (!CASE_PRIORITIES.includes(priority as never)) throw new BadRequestError("Unknown priority");
  const data = slaSchema.parse(input);
  if (data.firstResponseHours > data.resolutionHours) throw new BadRequestError("The first response cannot be due after the resolution");
  const db = scopedDb(ctx);
  if (!(await db.role.findFirst({ where: { name: data.escalateToRole }, select: { id: true } }))) throw new BadRequestError("Unknown role");
  const where = { brandId_priority: { brandId, priority: priority as CasePriority } };
  const before = await db.slaPolicy.findUnique({ where });
  const saved = await db.slaPolicy.upsert({ where, update: data, create: { brandId, priority: priority as CasePriority, ...data } });
  await audit({ ctx, action: before ? "UPDATE" : "CREATE", entity: "SlaPolicy", entityId: saved.id, brandId, before: before ?? undefined, after: saved });
  return saved;
}

// ───────────────────────────── business calendar ─────────────────────────────

const hoursSchema = z
  .object({
    workDays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Choose at least one working day").max(7),
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
  })
  .refine((d) => d.closesAt > d.opensAt, { message: "Closing time must be after opening time", path: ["closesAt"] });

function assertAdmin(ctx: AccessContext) {
  if (!ctx.isAdmin) throw new NotFoundError();
}

export async function getCalendarSettings(ctx: AccessContext) {
  const db = scopedDb(ctx);
  const [hours, holidays] = await Promise.all([db.businessHours.findUnique({ where: { id: "default" } }), db.holiday.findMany({ orderBy: { date: "asc" } })]);
  return { workDays: hours?.workDays ?? [1, 2, 3, 4, 5, 6], opensAt: hours?.opensAt ?? "08:00", closesAt: hours?.closesAt ?? "17:00", holidays: holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name })) };
}

export async function saveBusinessHours(ctx: AccessContext, input: unknown) {
  assertAdmin(ctx);
  const data = hoursSchema.parse(input);
  const saved = await scopedDb(ctx).businessHours.update({ where: { id: "default" }, data: { ...data, workDays: [...new Set(data.workDays)].sort() } });
  await audit({ ctx, action: "UPDATE", entity: "BusinessHours", entityId: "default", after: saved });
}

export async function addHoliday(ctx: AccessContext, input: { date: string; name: string }) {
  assertAdmin(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) throw new BadRequestError("Choose a date");
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new BadRequestError("Name the holiday");
  const date = new Date(`${input.date}T00:00:00Z`);
  const db = scopedDb(ctx);
  if (await db.holiday.findUnique({ where: { date } })) throw new BadRequestError("This date is already a holiday");
  await db.holiday.create({ data: { date, name } });
  await audit({ ctx, action: "CREATE", entity: "Holiday", entityId: input.date, after: { date: input.date, name } });
}

export async function removeHoliday(ctx: AccessContext, date: string) {
  assertAdmin(ctx);
  await scopedDb(ctx).holiday.deleteMany({ where: { date: new Date(`${date}T00:00:00Z`) } });
  await audit({ ctx, action: "DELETE", entity: "Holiday", entityId: date });
}

// ───────────────────────────── solutions (knowledge base) ─────────────────────────────

/** Brand articles: the brand's manager or an administrator. Group articles: administrators and management. */
export const canManageSolution = (ctx: AccessContext, brandId: string | null) => (brandId ? ctx.isAdmin || canManageBrandData(ctx, "cases", "edit", brandId) : ctx.isAdmin || ctx.scope === "ALL");
/** May the viewer manage at least one brand's (or the group's) articles – i.e. see drafts and the editor? */
export const isSolutionEditor = (ctx: AccessContext) => ctx.isAdmin || ctx.scope === "ALL" || ctx.memberships.some((m) => m.regionId === null && m.isManager);

/**
 * Articles the viewer may read: group articles and those of their own brands (RLS). Drafts are only shown to
 * users who can manage that article.
 */
export async function listSolutions(ctx: AccessContext, f: { q?: string; brandId?: string | null; tag?: string } = {}) {
  assertCan(ctx, "cases", "read");
  const q = f.q?.trim();
  const rows = await scopedDb(ctx).solution.findMany({
    where: {
      AND: [
        f.brandId ? { OR: [{ brandId: null }, { brandId: f.brandId }] } : {},
        f.tag ? { tags: { has: f.tag.toLowerCase() } } : {},
        q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { tags: { has: q.toLowerCase() } }] } : {},
      ],
    } satisfies Prisma.SolutionWhereInput,
    include: { brand: { select: { code: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });
  return rows.filter((s) => s.published || canManageSolution(ctx, s.brandId));
}

export async function getSolution(ctx: AccessContext, id: string) {
  assertCan(ctx, "cases", "read");
  const s = await scopedDb(ctx).solution.findUnique({ where: { id }, include: { brand: { select: { code: true, name: true } } } });
  if (!s || (!s.published && !canManageSolution(ctx, s.brandId))) throw new NotFoundError();
  return s;
}

export async function saveSolution(ctx: AccessContext, id: string | null, input: unknown) {
  const data = solutionSchema.parse(input);
  const db = scopedDb(ctx);
  const existing = id ? await db.solution.findUnique({ where: { id } }) : null;
  if (id && !existing) throw new NotFoundError();
  const brandId = existing ? existing.brandId : data.brandId; // the owner of an article never changes
  if (!canManageSolution(ctx, brandId)) throw new ForbiddenError(brandId ? "Only the brand's manager can change its articles" : "Group articles are managed by management");
  const values = { title: data.title, body: data.body, tags: data.tags, published: data.published };
  const saved = existing ? await db.solution.update({ where: { id: existing.id }, data: values }) : await db.solution.create({ data: { ...values, brandId, createdById: ctx.userId } });
  await audit({ ctx, action: existing ? "UPDATE" : "CREATE", entity: "Solution", entityId: saved.id, brandId, after: { title: saved.title, published: saved.published } });
  return { id: saved.id };
}

export async function deleteSolution(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const s = await db.solution.findUnique({ where: { id } });
  if (!s) throw new NotFoundError();
  if (!canManageSolution(ctx, s.brandId)) throw new ForbiddenError("Only the brand's manager can change its articles");
  await db.solution.delete({ where: { id } });
  await audit({ ctx, action: "DELETE", entity: "Solution", entityId: id, brandId: s.brandId, before: { title: s.title } });
}

/** Published articles that may help with a case: same brand or group, matching the case type or words of the subject. */
export async function suggestSolutions(ctx: AccessContext, c: { brandId: string; type: string; subject: string }, take = 5) {
  const words = [...new Set(c.subject.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))].slice(0, 6);
  const tag = c.type.toLowerCase().replace(/_/g, " ");
  return scopedDb(ctx).solution.findMany({
    where: { published: true, AND: [{ OR: [{ brandId: null }, { brandId: c.brandId }] }, { OR: [{ tags: { hasSome: [tag, c.type.toLowerCase(), ...words] } }, ...words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } }))] }] },
    select: { id: true, title: true, brandId: true },
    orderBy: { updatedAt: "desc" },
    take,
  });
}
