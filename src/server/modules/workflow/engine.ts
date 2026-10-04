/**
 * Workflow engine (prompt 08, part B).
 *
 *   record written (scopedDb hook) ─┐
 *   scheduler tick (cron)          ─┴→ Job "workflow.rule" → criteria on fresh facts → actions
 *
 * Actions run with a SYSTEM context that is bound to the record's brand: every read and write goes through
 * scopedDb + RLS with a single brand-level membership, so a rule can never touch another brand's records, and
 * notifications only go to users who can see the record.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Job, WorkflowRule } from "@prisma/client";
import { MODULE_KEYS } from "@/server/access/modules";
import type { AccessContext, PermissionMap } from "@/server/access/types";
import { evaluate, renderTemplate, toWhere, type Criteria, type Facts } from "@/server/automation/criteria";
import { scopedDb } from "@/server/db";
import { autoApproveDue } from "@/server/db/approval-engine";
import { claimJobs, completeJob, enqueueJob, failJob, saveJobProgress } from "@/server/db/jobs";
import { activeRules, alignDocumentWithDeal, documentMatchesDeal, getRule, recordBrand, scanRecords } from "@/server/db/workflow-store";
import { logger } from "@/server/log";
import { usersWhoCanSee } from "@/server/modules/activities/queries";
import { createActivity, processReminders } from "@/server/modules/activities/service";
import { notify } from "@/server/modules/notifications/service";
import { fieldMap, wfModule, wfModuleByModel, type WfModule } from "./modules";
import { actionSchema, type WorkflowAction } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic over brand-owned delegates */

const ALL_PERMISSIONS = Object.fromEntries(MODULE_KEYS.map((k) => [k, { read: true, create: true, edit: true }])) as PermissionMap;

/** System context bound to ONE brand (all its regions). `automation` stops rules from triggering rules. */
export function automationContext(brandId: string, scope: "TERRITORY" | "ALL" = "TERRITORY"): AccessContext {
  return {
    userId: "",
    user: { name: "Workflow", email: "", roleName: "System" },
    scope,
    profile: { id: "system", name: "System", permissions: ALL_PERMISSIONS, fieldPermissions: {} },
    memberships: scope === "ALL" ? [] : [{ territoryId: "system", brandId, regionId: null, isManager: true }],
    brandIds: [brandId],
    isAdmin: false,
    system: true,
    automation: true,
  };
}

// ───────────────────────────── facts ─────────────────────────────

const DELEGATE: Record<WfModule["model"], string> = { Lead: "lead", Deal: "deal", Quote: "quote", SalesOrder: "salesOrder", Case: "case" };

function plain(v: unknown): unknown {
  if (v === null || v === undefined || v instanceof Date) return v;
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber: () => number }).toNumber();
  return v;
}

/** The record as flat facts (scalars + derived fields such as stageType / isOpen / name). Null when hidden. */
export async function loadFacts(ctx: AccessContext, mod: WfModule, id: string): Promise<Facts | null> {
  const db = scopedDb(ctx) as any;
  const record = await db[DELEGATE[mod.model]].findUnique({ where: { id }, ...(mod.model === "Deal" ? { include: { stage: { select: { type: true, key: true, name: true } } } } : {}) });
  if (!record) return null;
  const facts: Facts = {};
  for (const [k, v] of Object.entries(record)) if (v === null || typeof v !== "object" || v instanceof Date || typeof (v as any).toNumber === "function") facts[k] = plain(v);
  if (mod.model === "Deal") {
    facts.stageType = record.stage?.type ?? null;
    facts.stageKey = record.stage?.key ?? null;
    facts.stageName = record.stage?.name ?? null;
    facts.isOpen = record.stage?.type === "OPEN";
  }
  if (mod.model === "Lead") facts.name = [record.firstName, record.lastName].filter(Boolean).join(" ");
  if (mod.model === "Quote" || mod.model === "SalesOrder") facts.name = record.number;
  if (mod.model === "Case") {
    const now = Date.now();
    facts.name = `${record.number} ${record.subject}`;
    facts.isOpen = ["NEW", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "ESCALATED"].includes(record.status);
    facts.slaBreached = (!!record.slaDueAt && record.slaDueAt.getTime() < now) || (!record.firstRespondedAt && !!record.firstResponseDueAt && record.firstResponseDueAt.getTime() < now);
  }
  return facts;
}

// ───────────────────────────── trigger: record written ─────────────────────────────

/**
 * Called by scopedDb after a single create / update of a brand-owned record. Enqueues one job per matching rule;
 * never throws (automation must not break the user's action). Writes made by rules themselves are ignored.
 */
export async function onRecordWritten(ctx: AccessContext, model: string, op: "create" | "update", before: Record<string, unknown> | null | undefined, result: unknown, data: Record<string, unknown>): Promise<void> {
  try {
    if (ctx.automation) return;
    const mod = wfModuleByModel(model);
    if (!mod) return;
    const id = (result as { id?: string } | null)?.id ?? (before?.id as string | undefined);
    const brandId = (before?.brandId as string | undefined) ?? (data.brandId as string | undefined) ?? (result as { brandId?: string } | null)?.brandId;
    if (!id || !brandId) return;
    const value = (v: unknown) => (typeof v === "object" && v !== null && "set" in v ? (v as { set: unknown }).set : v);
    const changed = op === "create" ? [] : Object.keys(data).filter((k) => String(plain(before?.[k]) ?? "") !== String(plain(value(data[k])) ?? ""));
    const rules = (await activeRules()).filter((r) => {
      if (r.module !== mod.key || (r.brandId && r.brandId !== brandId)) return false;
      if (op === "create") return r.trigger === "ON_CREATE";
      if (r.trigger === "ON_EDIT") return changed.some((c) => c !== "updatedById");
      return r.trigger === "FIELD_CHANGE" && changed.includes(String((r.triggerConfig as { field?: string }).field));
    });
    for (const r of rules) await enqueueJob({ type: "workflow.rule", payload: { ruleId: r.id, recordId: id, event: op, changed }, brandId, ruleId: r.id });
    if (rules.length) kick();
  } catch (err) {
    logger.error({ err, model, op }, "workflow trigger failed");
  }
}

// ───────────────────────────── scheduler ─────────────────────────────

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Finds the records scheduled / date-based rules apply to and enqueues one idempotent job per rule + record. */
export async function runScheduler(now = new Date()): Promise<number> {
  let enqueued = 0;
  for (const rule of await activeRules()) {
    if (rule.trigger !== "SCHEDULED" && rule.trigger !== "DATE_BASED") continue;
    const mod = wfModule(rule.module);
    if (!mod) continue;
    const cfg = rule.triggerConfig as { dateField?: string; offsetDays?: number; repeat?: string };
    try {
      const where: Record<string, unknown>[] = [toWhere(rule.criteria as Criteria, fieldMap(mod), now)];
      if (rule.trigger === "DATE_BASED") {
        // offsetDays > 0: that many days AFTER the date; < 0: before it. The rule fires on that calendar day.
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (cfg.offsetDays ?? 0) * 86_400_000);
        where.push({ [cfg.dateField!]: { gte: start, lt: new Date(start.getTime() + 86_400_000) } });
      }
      for (const rec of await scanRecords(mod.model, { AND: where }, rule.brandId)) {
        const suffix = rule.trigger === "DATE_BASED" ? dayKey(now) : cfg.repeat === "PER_UPDATE" ? String(rec.updatedAt.getTime()) : "once";
        const id = await enqueueJob({ type: "workflow.rule", payload: { ruleId: rule.id, recordId: rec.id, event: "scheduled" }, brandId: rec.brandId, ruleId: rule.id, idempotencyKey: `wf:${rule.id}:${rec.id}:${suffix}` });
        if (id) enqueued++;
      }
    } catch (err) {
      logger.error({ err, rule: rule.id }, "scheduled rule could not be evaluated");
    }
  }
  return enqueued;
}

// ───────────────────────────── actions ─────────────────────────────

async function recipients(ctx: AccessContext, facts: Facts, to: string, roleName?: string): Promise<string[]> {
  const brandId = String(facts.brandId);
  const allowed = new Set((await usersWhoCanSee(ctx, brandId, String(facts.regionId))).map((u) => u.id));
  let ids: string[] = [];
  if (to === "OWNER") ids = [String(facts.ownerId)];
  else if (to === "BRAND_MANAGER") ids = await brandManagerIds(ctx, brandId);
  else if (to === "ROLE" && roleName) ids = (await scopedDb(ctx).user.findMany({ where: { active: true, role: { name: roleName } }, select: { id: true } })).map((u) => u.id);
  // Brand boundary: only users who can see the record are ever notified.
  return ids.filter((u) => allowed.has(u));
}

async function brandManagerIds(ctx: AccessContext, brandId: string): Promise<string[]> {
  const brand = await scopedDb(ctx).brand.findUnique({ where: { id: brandId }, select: { brandManager: { select: { id: true, active: true } } } });
  return brand?.brandManager?.active ? [brand.brandManager.id] : [];
}

/** https only, and never to loopback / private / link-local addresses (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Webhooks must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  const isPrivate = (ip: string) =>
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === "::1" || ip === "::" || /^(fc|fd|fe80)/i.test(ip) || /^::ffff:/i.test(ip);
  if (addresses.length === 0 || addresses.some(isPrivate)) throw new Error("Webhook target is not a public address");
  return url;
}

async function runAction(ctx: AccessContext, rule: WorkflowRule, mod: WfModule, facts: Facts, action: WorkflowAction): Promise<string> {
  const db = scopedDb(ctx) as any;
  const id = String(facts.id);
  const brandId = String(facts.brandId);
  const parent = mod.model === "Lead" ? { parentType: "Lead", parentId: id } : mod.model === "Case" ? { parentType: "Case", parentId: id } : mod.model === "Deal" ? { parentType: "Deal", parentId: id } : { parentType: "Deal", parentId: String(facts.dealId) };
  switch (action.type) {
    case "FIELD_UPDATE": {
      const def = fieldMap(mod)[action.field];
      if (!def?.updatable) return `skipped: ${action.field} cannot be updated`;
      const value = action.value === null || action.value === "" ? null : def.type === "number" ? Number(action.value) : def.type === "date" ? new Date(String(action.value)) : def.type === "boolean" ? action.value === true || action.value === "true" : action.value;
      await db[DELEGATE[mod.model]].update({ where: { id }, data: { [action.field]: value }, select: { id: true } });
      return `set ${action.field}`;
    }
    case "CREATE_TASK": {
      const ownerId = action.assignee === "BRAND_MANAGER" ? ((await brandManagerIds(ctx, brandId))[0] ?? String(facts.ownerId)) : String(facts.ownerId);
      const due = new Date(Date.now() + action.dueInHours * 3_600_000).toISOString();
      const a = await createActivity(ctx, { type: action.activityType, ...parent, subject: renderTemplate(action.subject, facts), dueAt: due, priority: action.priority, ownerId, description: `Created by workflow rule "${rule.name}"` } as never);
      return `task ${a.id}`;
    }
    case "SEND_NOTIFICATION": {
      const to = await recipients(ctx, facts, action.to, action.roleName);
      const href = mod.model === "Lead" ? `/leads/${id}` : mod.model === "Case" ? `/cases/${id}` : mod.model === "Deal" ? `/deals/${id}` : mod.model === "Quote" ? `/quotes/${id}` : `/salesOrders/${id}`;
      await notify(ctx, to, { kind: "INFO", title: renderTemplate(action.title, facts), body: action.body ? renderTemplate(action.body, facts) : null, href });
      return `notified ${to.length}`;
    }
    case "SEND_EMAIL": {
      const to = await recipients(ctx, facts, action.to, action.roleName);
      // Sent by the messaging service with the brand's sender identity (recipients are CRM users who can see the record).
      if (to.length) await enqueueJob({ type: "email.users", payload: { userIds: to, subject: renderTemplate(action.subject, facts), text: renderTemplate(action.body, facts), brandId }, brandId, ruleId: rule.id });
      return `email queued for ${to.length}`;
    }
    case "WEBHOOK": {
      const url = await assertPublicUrl(action.url);
      const brand = await scopedDb(ctx).brand.findUnique({ where: { id: brandId }, select: { code: true } });
      // Ids only – the receiver fetches details through the API with its own (brand-scoped) credentials.
      const body = JSON.stringify({ event: "workflow.rule", rule: rule.key ?? rule.id, module: mod.key, recordId: id, brand: brand?.code, at: new Date().toISOString() });
      const secret = process.env.WEBHOOK_SECRET;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret ? { "X-Stallion-Signature": createHmac("sha256", secret).update(body).digest("hex") } : {}) },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
      return `webhook ${res.status}`;
    }
    case "ASSIGN_OWNER": {
      const ownerId = action.to === "USER" ? action.userId : (await brandManagerIds(ctx, brandId))[0];
      if (!ownerId) return "skipped: no owner found";
      // scopedDb enforces that the new owner works in the record's brand and region.
      await db[DELEGATE[mod.model]].update({ where: { id }, data: { ownerId }, select: { id: true } });
      return `owner ${ownerId}`;
    }
    case "CALL_FUNCTION": {
      if (action.name === "copyBrandFromDeal" && (mod.model === "Quote" || mod.model === "SalesOrder")) {
        if (await documentMatchesDeal(mod.model, id)) return "brand and region match the deal";
        await alignDocumentWithDeal(mod.model, id);
        logger.warn({ model: mod.model, id }, "document brand/region diverged from its deal – repaired");
        return "repaired brand and region";
      }
      if (action.name === "escalateCase" && mod.model === "Case") return (await import("@/server/modules/cases/service")).escalateCase(ctx, id);
      return "skipped: unknown function";
    }
  }
}

/** Runs one rule for one record. Returns what happened (stored in the run log). */
export async function executeRule(job: Pick<Job, "id" | "payload" | "result">): Promise<Record<string, unknown>> {
  const { ruleId, recordId } = job.payload as { ruleId: string; recordId: string };
  const rule = await getRule(ruleId);
  if (!rule || !rule.active) return { skipped: "rule is inactive or deleted" };
  const mod = wfModule(rule.module);
  if (!mod) return { skipped: "unknown module" };
  const where = await recordBrand(mod.model, recordId);
  if (!where) return { skipped: "record no longer exists" };
  if (rule.brandId && rule.brandId !== where.brandId) return { skipped: "record belongs to another brand" };
  const ctx = automationContext(where.brandId);
  const facts = await loadFacts(ctx, mod, recordId);
  if (!facts) return { skipped: "record not visible" };
  if (!evaluate(rule.criteria as Criteria, facts)) return { skipped: "criteria no longer match" };
  const actions = (Array.isArray(rule.actions) ? rule.actions : []).map((a) => actionSchema.parse(a));
  const progress = (job.result as { done?: number; log?: string[] } | null) ?? {};
  const log = progress.log ?? [];
  for (let i = progress.done ?? 0; i < actions.length; i++) {
    try {
      log.push(`${actions[i]!.type}: ${await runAction(ctx, rule, mod, facts, actions[i]!)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("RECORD_LOCKED")) log.push(`${actions[i]!.type}: skipped – record is locked by a pending approval`);
      else throw err;
    }
    // A retry continues after the last completed action (no duplicate tasks / notifications).
    await saveJobProgress(job.id, { done: i + 1, log });
  }
  return { done: actions.length, log, rule: rule.name };
}

// ───────────────────────────── worker ─────────────────────────────

const HANDLERS: Record<string, (job: Job) => Promise<unknown>> = {
  "workflow.rule": executeRule,
  // lazy imports: the messaging module itself uses the automation context of this file
  "campaign.batch": async (job) => (await import("@/server/modules/messaging/campaigns")).processCampaignBatch(job),
  "import.run": async (job) => (await import("@/server/modules/imports/service")).runImport(job),
  "export.run": async (job) => (await import("@/server/modules/exports/service")).runExport(job),
  "email.users": async (job) => {
    const p = job.payload as { userIds: string[]; subject: string; text: string; brandId?: string | null };
    return { sent: await (await import("@/server/modules/messaging/service")).emailUsers(p.userIds, p.subject, p.text, p.brandId) };
  },
};

/** Claims and runs due jobs. Safe to call concurrently (SKIP LOCKED) and repeatedly. */
export async function runDueJobs(limit = 25): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const job of await claimJobs(limit)) {
    try {
      const handler = HANDLERS[job.type];
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await completeJob(job.id, await handler(job));
      done++;
    } catch (err) {
      failed++;
      const status = await failJob(job, err);
      logger.warn({ err, job: job.id, type: job.type, status }, "job failed");
    }
  }
  return { done, failed };
}

let kicking = false;
/** Event-triggered rules run right after the request (long-running server); the cron tick is the safety net. */
function kick() {
  if (process.env.JOBS_INLINE === "0" || kicking) return;
  kicking = true;
  setImmediate(() => {
    runDueJobs()
      .catch((err) => logger.error({ err }, "inline job run failed"))
      .finally(() => {
        kicking = false;
      });
  });
}

/** One scheduler tick (cron): scheduled rules, due jobs, activity reminders and approval auto-approvals. */
export async function tick(now = new Date()) {
  const scheduled = await runScheduler(now);
  const jobs = await runDueJobs(100);
  const reminders = await processReminders(automationContext("", "ALL"), now);
  const autoApproved = (await autoApproveDue(now)).length;
  const expiredExports = await (await import("@/server/modules/exports/service")).purgeExpiredExports();
  return { scheduled, ...jobs, reminders, autoApproved, expiredExports };
}
