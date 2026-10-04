import "server-only";
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { DEFAULT_CALENDAR, type BusinessCalendar } from "./business-hours";
import { OPEN_STATUSES } from "./schema";

const select = {
  id: true,
  number: true,
  subject: true,
  description: true,
  type: true,
  priority: true,
  channel: true,
  status: true,
  accountId: true,
  account: { select: { name: true } },
  contactId: true,
  contact: { select: { firstName: true, lastName: true } },
  dealId: true,
  deal: { select: { name: true } },
  salesOrderId: true,
  vin: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  unassigned: true,
  firstResponseDueAt: true,
  firstRespondedAt: true,
  slaDueAt: true,
  escalatedAt: true,
  resolvedAt: true,
  closedAt: true,
  resolution: true,
  satisfactionScore: true,
  satisfactionNote: true,
  surveySentAt: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  owner: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CaseSelect;
type CaseRecord = Prisma.CaseGetPayload<{ select: typeof select }>;

export type SlaState = "none" | "ok" | "due_soon" | "breached" | "met" | "missed";

export interface CaseRow {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  type: string;
  priority: string;
  channel: string;
  status: string;
  open: boolean;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  salesOrderId: string | null;
  vin: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  unassigned: boolean;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  slaDueAt: string | null;
  /** resolution SLA: breached / due soon while open, met / missed once resolved */
  sla: SlaState;
  /** first-response SLA */
  firstResponse: SlaState;
  escalatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
  satisfactionScore: number | null;
  satisfactionNote: string | null;
  surveySentAt: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
const SOON_MS = 4 * 3_600_000;

function state(due: Date | null, done: Date | null, now: Date): SlaState {
  if (!due) return "none";
  if (done) return done <= due ? "met" : "missed";
  if (due < now) return "breached";
  return due.getTime() - now.getTime() < SOON_MS ? "due_soon" : "ok";
}

function toRow(c: CaseRecord, now = new Date()): CaseRow {
  const open = (OPEN_STATUSES as string[]).includes(c.status);
  return {
    id: c.id,
    number: c.number,
    subject: c.subject,
    description: c.description,
    type: c.type,
    priority: c.priority,
    channel: c.channel,
    status: c.status,
    open,
    accountId: c.accountId,
    accountName: c.account?.name ?? null,
    contactId: c.contactId,
    contactName: c.contact ? [c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ") : null,
    dealId: c.dealId,
    dealName: c.deal?.name ?? null,
    salesOrderId: c.salesOrderId,
    vin: c.vin,
    customerName: c.customerName,
    customerPhone: c.customerPhone,
    customerEmail: c.customerEmail,
    unassigned: c.unassigned,
    firstResponseDueAt: iso(c.firstResponseDueAt),
    firstRespondedAt: iso(c.firstRespondedAt),
    slaDueAt: iso(c.slaDueAt),
    sla: state(c.slaDueAt, c.resolvedAt, now),
    firstResponse: state(c.firstResponseDueAt, c.firstRespondedAt, now),
    escalatedAt: iso(c.escalatedAt),
    resolvedAt: iso(c.resolvedAt),
    closedAt: iso(c.closedAt),
    resolution: c.resolution,
    satisfactionScore: c.satisfactionScore,
    satisfactionNote: c.satisfactionNote,
    surveySentAt: iso(c.surveySentAt),
    brandId: c.brandId,
    regionId: c.regionId,
    ownerId: c.ownerId,
    ownerName: c.owner.name,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const QUEUES = [
  { id: "my", name: "My Cases" },
  { id: "unassigned", name: "Unassigned – My Brand" },
  { id: "breaching", name: "Breaching SLA" },
  { id: "open", name: "All Open Cases" },
  { id: "all", name: "All Cases" },
] as const;
export type QueueId = (typeof QUEUES)[number]["id"];

const open = { status: { in: OPEN_STATUSES } } satisfies Prisma.CaseWhereInput;
/** Open cases whose resolution or first-response time has passed. */
export const breachingWhere = (now = new Date()): Prisma.CaseWhereInput => ({ ...open, OR: [{ slaDueAt: { lt: now } }, { firstRespondedAt: null, firstResponseDueAt: { lt: now } }] });

export function queueWhere(ctx: AccessContext, queue: string, now = new Date()): Prisma.CaseWhereInput {
  switch (queue) {
    case "unassigned":
      return { ...open, unassigned: true };
    case "breaching":
      return breachingWhere(now);
    case "open":
      return open;
    case "all":
      return {};
    default:
      return { ...open, ownerId: ctx.userId };
  }
}

export interface CaseFilter {
  queue?: string;
  q?: string;
  type?: string;
  accountId?: string;
  dealId?: string;
}

export async function listCases(ctx: AccessContext, f: CaseFilter = {}, ui: UiFilters = {}, opts: { take?: number; skip?: number } = {}): Promise<{ rows: CaseRow[]; total: number }> {
  assertCan(ctx, "cases", "read");
  const db = scopedDb(ctx);
  const q = f.q?.trim();
  const where: Prisma.CaseWhereInput = {
    AND: [
      filterWhere(ctx, ui),
      queueWhere(ctx, f.queue ?? "my"),
      f.type ? { type: f.type as never } : {},
      f.accountId ? { accountId: f.accountId } : {},
      f.dealId ? { dealId: f.dealId } : {},
      q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    db.case.findMany({ where, select, orderBy: f.queue === "all" ? [{ createdAt: "desc" }] : [{ slaDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: Math.min(opts.take ?? 50, 500), skip: opts.skip ?? 0 }),
    db.case.count({ where }),
  ]);
  const now = new Date();
  return { rows: rows.map((r) => toRow(r, now)), total };
}

/** Number of cases per queue (tabs). */
export async function queueCounts(ctx: AccessContext, ui: UiFilters = {}): Promise<Record<string, number>> {
  const db = scopedDb(ctx);
  const counts = await Promise.all(QUEUES.filter((q) => q.id !== "all").map((q) => db.case.count({ where: { AND: [filterWhere(ctx, ui), queueWhere(ctx, q.id)] } })));
  return Object.fromEntries(QUEUES.filter((q) => q.id !== "all").map((q, i) => [q.id, counts[i]!]));
}

/** 404 for missing and out-of-scope cases alike. */
export async function getCase(ctx: AccessContext, id: string): Promise<CaseRow> {
  assertCan(ctx, "cases", "read");
  const c = await scopedDb(ctx).case.findFirst({ where: { OR: [{ id }, { number: id }] }, select });
  if (!c) throw new NotFoundError();
  return toRow(c);
}

export async function searchCases(ctx: AccessContext, q: string, take = 10) {
  return scopedDb(ctx).case.findMany({
    where: { OR: [{ number: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] },
    select: { id: true, number: true, subject: true, status: true, brandId: true, regionId: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** The group's business calendar (hours + holidays) for SLA timers. */
export async function loadCalendar(ctx: AccessContext): Promise<BusinessCalendar> {
  const db = scopedDb(ctx);
  const [hours, holidays] = await Promise.all([db.businessHours.findUnique({ where: { id: "default" } }), db.holiday.findMany({ select: { date: true } })]);
  return {
    workDays: hours?.workDays.length ? hours.workDays : DEFAULT_CALENDAR.workDays,
    opensAt: hours?.opensAt ?? DEFAULT_CALENDAR.opensAt,
    closesAt: hours?.closesAt ?? DEFAULT_CALENDAR.closesAt,
    holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  };
}
