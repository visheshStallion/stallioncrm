import type { JobStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Pagination } from "@/components/crm/ListPage";
import { EmptyState, StatusPill, type Tone } from "@/components/crm/primitives";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listJobs } from "@/server/db/jobs";
import { listRules } from "@/server/db/workflow-store";
import { parsePaging } from "@/server/list/filters";
import { getPreferences } from "@/server/modules/preferences/queries";
import { retryJobAction, runSchedulerAction } from "@/server/modules/workflow/actions";
import { requireContext } from "@/server/request";

export const metadata = { title: "Automation run log" };

const STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "DONE", "FAILED", "DEAD"];
const TONE: Record<JobStatus, Tone> = { QUEUED: "info", RUNNING: "primary", DONE: "success", FAILED: "warning", DEAD: "danger" };

/** Run log of the job queue: every workflow run with its result, attempts and last error. Administrators only. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; per?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.isAdmin) notFound();
  const status = STATUSES.includes(sp.status as JobStatus) ? (sp.status as JobStatus) : undefined;
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const [{ rows, total, counts }, rules, prefs] = await Promise.all([listJobs({ status, take: paging.per, skip: paging.skip }), listRules(), getPreferences(ctx)]);
  const ruleName = (id: string | null) => rules.find((r) => r.id === id)?.name ?? "—";
  const chip = "rounded-full border px-2.5 py-0.5 text-xs";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Automation run log</h2>
        <Link href="/admin/jobs" className={cn(chip, !status ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/jobs?status=${s}`} className={cn(chip, status === s ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
            {s.charAt(0) + s.slice(1).toLowerCase()} {counts[s] ?? 0}
          </Link>
        ))}
        <ActionForm action={runSchedulerAction} className="ml-auto">
          <SubmitButton size="sm" variant="outline">
            Run scheduler now
          </SubmitButton>
        </ActionForm>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No jobs" text="Workflow runs appear here with their result, attempts and errors." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="job-log">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Result / error</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const payload = (j.payload ?? {}) as { recordId?: string; event?: string };
                const result = j.result as { log?: string[]; skipped?: string } | null;
                return (
                  <tr key={j.id} className="border-b border-border align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(j.createdAt, prefs.dateFormat)}</td>
                    <td className="px-3 py-2">{ruleName(j.ruleId)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {payload.recordId ?? "—"}
                      {payload.event ? <div className="font-sans text-text-muted">{payload.event}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={TONE[j.status]}>{j.status}</StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      {j.attempts} / {j.maxAttempts}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {j.lastError ? <div className="text-danger">{j.lastError}</div> : null}
                      {result?.skipped ? <div className="text-text-muted">Skipped: {result.skipped}</div> : null}
                      {result?.log?.map((l, i) => <div key={i}>{l}</div>)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {j.status === "FAILED" || j.status === "DEAD" ? (
                        <ActionForm action={retryJobAction}>
                          <input type="hidden" name="id" value={j.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Retry
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </div>
  );
}
