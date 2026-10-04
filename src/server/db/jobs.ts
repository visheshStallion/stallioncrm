/**
 * Job queue on PostgreSQL (prompt 08): `FOR UPDATE SKIP LOCKED` claiming, retries with exponential back-off,
 * idempotency keys and a run log. The `Job` table is system-only (the RLS role has no access), so the queue
 * lives in the db layer. A dedicated queue library (pg-boss) was not needed for this volume – the table gives
 * the same guarantees and doubles as the run log.
 */
import "server-only";
import type { Job, JobStatus, Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

export interface EnqueueJob {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  /** a second enqueue with the same key is a no-op (returns null) */
  idempotencyKey?: string | null;
  brandId?: string | null;
  ruleId?: string | null;
  maxAttempts?: number;
}

export async function enqueueJob(job: EnqueueJob): Promise<string | null> {
  // skipDuplicates: an idempotency key that already exists makes this a silent no-op.
  const rows = await unsafeDb.job.createManyAndReturn({
    data: [
      {
        type: job.type,
        payload: (job.payload ?? {}) as Prisma.InputJsonValue,
        runAt: job.runAt ?? new Date(),
        idempotencyKey: job.idempotencyKey ?? null,
        brandId: job.brandId ?? null,
        ruleId: job.ruleId ?? null,
        maxAttempts: job.maxAttempts ?? 5,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0]?.id ?? null;
}

const STUCK_MINUTES = 10;

/** Claims due jobs for this worker. Jobs left RUNNING by a crashed worker are picked up again after 10 minutes. */
export async function claimJobs(limit = 20, now = new Date()): Promise<Job[]> {
  const stuck = new Date(now.getTime() - STUCK_MINUTES * 60_000);
  return unsafeDb.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'RUNNING', attempts = attempts + 1, "startedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE (status IN ('QUEUED', 'FAILED') AND "runAt" <= ${now}) OR (status = 'RUNNING' AND "startedAt" < ${stuck})
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(id: string, result: unknown): Promise<void> {
  await unsafeDb.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lastError: null, result: JSON.parse(JSON.stringify(result ?? null)) ?? undefined } });
}

/** Progress of a multi-step job, so a retry continues where the failed attempt stopped. */
export async function saveJobProgress(id: string, result: unknown): Promise<void> {
  await unsafeDb.job.update({ where: { id }, data: { result: JSON.parse(JSON.stringify(result)) } });
}

/** Failed attempt: retried with exponential back-off (1, 2, 4 … minutes) until maxAttempts, then DEAD. */
export async function failJob(job: Pick<Job, "id" | "attempts" | "maxAttempts">, error: unknown, now = new Date()): Promise<JobStatus> {
  const dead = job.attempts >= job.maxAttempts;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  await unsafeDb.job.update({
    where: { id: job.id },
    data: { status: dead ? "DEAD" : "FAILED", lastError: message, finishedAt: dead ? now : null, runAt: dead ? undefined : new Date(now.getTime() + 2 ** (job.attempts - 1) * 60_000) },
  });
  return dead ? "DEAD" : "FAILED";
}

// ───────────────────────────── run log (administrators) ─────────────────────────────

export async function listJobs(filter: { status?: JobStatus; ruleId?: string; take?: number; skip?: number } = {}) {
  const where: Prisma.JobWhereInput = { ...(filter.status ? { status: filter.status } : {}), ...(filter.ruleId ? { ruleId: filter.ruleId } : {}) };
  const [rows, total, counts] = await Promise.all([
    unsafeDb.job.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(filter.take ?? 50, 200), skip: filter.skip ?? 0 }),
    unsafeDb.job.count({ where }),
    unsafeDb.job.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<JobStatus, number>> };
}

/** Puts a failed / dead job back in the queue. */
export async function retryJob(id: string): Promise<boolean> {
  const res = await unsafeDb.job.updateMany({ where: { id, status: { in: ["FAILED", "DEAD"] } }, data: { status: "QUEUED", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null } });
  return res.count === 1;
}
