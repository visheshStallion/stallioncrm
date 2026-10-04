/**
 * Offline support for the mobile PWA (prompt 14).
 *
 * `snapshot` is what a phone may keep for offline reading: the caller's OWN open leads, deals and activities,
 * produced by the same list queries as the screens (scopedDb + masking) – nothing the user cannot see online.
 * `scopeHash` changes whenever the user's access changes (territories, profile, permissions): the client
 * compares it on every refresh and wipes its cache when it differs, as it does on logout or a change of user.
 *
 * `syncOutbox` replays quick actions recorded offline (create lead, log call, add note). Each operation carries
 * a client-generated key and is applied at most once; it runs with the user's CURRENT access, so an action on a
 * record the user has lost access to (or that was deleted meanwhile) comes back as a conflict – it is never
 * applied on the strength of what the user could see when they recorded it.
 */
import "server-only";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { fieldMaskMany } from "@/server/access/field-mask";
import { findIdempotent, storeIdempotent } from "@/server/db/api-store";
import { BadRequestError } from "@/server/errors";
import { listActivities } from "@/server/modules/activities/queries";
import { createActivity } from "@/server/modules/activities/service";
import { listDeals } from "@/server/modules/deals/queries";
import { listLeads } from "@/server/modules/leads/queries";
import { parseLeadFilters } from "@/server/modules/leads/schema";
import { createLead } from "@/server/modules/leads/service";
import { addNote } from "@/server/modules/notes/service";

const LIMIT = 200;

/** Fingerprint of everything that decides what the user may see. */
export function scopeHash(ctx: AccessContext): string {
  const perms = Object.fromEntries(["leads", "deals", "activities"].map((m) => [m, ctx.profile.permissions[m as "leads"] ?? {}]));
  const basis = { u: ctx.userId, s: ctx.scope, p: ctx.profile.id, perms, f: ctx.profile.fieldPermissions, m: ctx.memberships.map((m) => `${m.brandId}|${m.regionId ?? "*"}|${m.isManager ? 1 : 0}`).sort(), b: [...ctx.brandIds].sort() };
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex").slice(0, 24);
}

export async function snapshot(ctx: AccessContext) {
  const [leads, deals, activities] = await Promise.all([
    hasPermission(ctx, "leads", "read") ? listLeads(ctx, parseLeadFilters({ mine: "true" }), { take: LIMIT }).then((r) => r.rows.filter((l) => l.status !== "UNQUALIFIED")) : [],
    hasPermission(ctx, "deals", "read") ? listDeals(ctx, {}, { take: LIMIT, where: { ownerId: ctx.userId, stage: { type: "OPEN" } } }).then((r) => fieldMaskMany(ctx, "deals", r.rows)) : [],
    hasPermission(ctx, "activities", "read") ? listActivities(ctx, { view: "my" }, {}, { take: LIMIT, order: "asc" }).then((r) => fieldMaskMany(ctx, "activities", r.rows)) : [],
  ]);
  const pick = <T extends object>(rows: T[], keys: string[]) => rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, (r as Record<string, unknown>)[k]])));
  return {
    userId: ctx.userId,
    scopeHash: scopeHash(ctx),
    generatedAt: new Date().toISOString(),
    leads: pick(leads, ["id", "name", "mobile", "email", "city", "status", "rating", "modelName", "brandId", "regionId", "updatedAt"]),
    deals: pick(deals as object[], ["id", "name", "customerName", "stageName", "amount", "closeDate", "modelName", "vinChassisNo", "brandId", "regionId", "updatedAt"]),
    activities: pick(activities as object[], ["id", "subject", "type", "status", "dueAt", "startAt", "parentType", "parentId", "phone", "brandId", "regionId"]),
  };
}

export const OFFLINE_OPS = ["lead.create", "call.log", "note.add"] as const;
export interface OfflineOp {
  key: string;
  type: (typeof OFFLINE_OPS)[number];
  payload: Record<string, unknown>;
  /** when the user recorded it on the device */
  at?: string;
}
export interface OfflineResult {
  key: string;
  status: "ok" | "duplicate" | "conflict" | "error";
  message?: string;
  id?: string;
}

async function apply(ctx: AccessContext, op: OfflineOp): Promise<string> {
  const p = op.payload;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (op.type) {
    case "lead.create": {
      const lead = await createLead(ctx, { firstName: s("firstName") || undefined, lastName: s("lastName"), mobile: s("mobile"), email: s("email") || undefined, source: s("source") || "WALK_IN", brandId: s("brandId"), regionId: s("regionId"), city: s("city") || undefined } as never, { autoAssign: false });
      return (lead as { id: string }).id;
    }
    case "call.log": {
      const parentType = s("parentType");
      if (!["Lead", "Deal"].includes(parentType)) throw new BadRequestError("A call is logged on a lead or a deal");
      const at = op.at && !Number.isNaN(Date.parse(op.at)) ? op.at : new Date().toISOString();
      const a = await createActivity(ctx, { type: "CALL", parentType: parentType as "Lead" | "Deal", parentId: s("parentId"), subject: s("subject") || "Call", outcome: s("outcome") || undefined, direction: s("direction") === "INBOUND" ? "INBOUND" : "OUTBOUND", phone: s("phone") || undefined, completed: true, dueAt: at });
      return (a as { id: string }).id;
    }
    case "note.add": {
      const note = await addNote(ctx, s("entity"), s("entityId"), s("body"));
      return (note as { id?: string } | undefined)?.id ?? "";
    }
    default:
      throw new BadRequestError("Unknown offline action");
  }
}

export async function syncOutbox(ctx: AccessContext, ops: unknown): Promise<OfflineResult[]> {
  if (!Array.isArray(ops) || ops.length > 100) throw new BadRequestError("Send up to 100 operations");
  const scope = `offline:${ctx.userId}`;
  const results: OfflineResult[] = [];
  for (const raw of ops as OfflineOp[]) {
    const key = typeof raw?.key === "string" ? raw.key.slice(0, 100) : "";
    if (!key || !(OFFLINE_OPS as readonly string[]).includes(raw.type) || typeof raw.payload !== "object" || raw.payload === null) {
      results.push({ key, status: "error", message: "Malformed operation" });
      continue;
    }
    const seen = await findIdempotent(scope, key);
    if (seen) {
      results.push({ key, status: "duplicate", id: (seen.body as { id?: string } | null)?.id });
      continue;
    }
    try {
      const id = await apply(ctx, raw);
      await storeIdempotent(scope, key, raw.type, 200, { id });
      results.push({ key, status: "ok", id });
    } catch (err) {
      // 403 / 404 now: the user's access changed or the record is gone – the action is not applied
      if (isAccessError(err)) results.push({ key, status: "conflict", message: err.status === 404 ? "The record is no longer available to you" : err.message });
      else if (err instanceof ZodError) results.push({ key, status: "error", message: err.issues[0] ? `${err.issues[0].path.join(".")}: ${err.issues[0].message}` : "Invalid input" });
      else if (err instanceof BadRequestError) results.push({ key, status: "error", message: err.message });
      else throw err;
    }
  }
  return results;
}
