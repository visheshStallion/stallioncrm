import Link from "next/link";
import { StatusPill } from "@/components/crm/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { systemHealth } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "System health" };

export default async function HealthPage() {
  const { ctx, entry } = await requireSetup("system-health"); // setupPermission: ADMIN (delegable)
  const h = await systemHealth(ctx);
  const tiles: Array<{ label: string; value: number; bad: boolean; hint: string }> = [
    { label: "Jobs waiting", value: h.jobs.QUEUED ?? 0, bad: h.overdueJobs > 0, hint: h.overdueJobs ? `${h.overdueJobs} are more than 15 minutes late – is the scheduler running?` : "in time" },
    { label: "Jobs failed for good", value: h.jobs.DEAD ?? 0, bad: (h.jobs.DEAD ?? 0) > 0, hint: "gave up after all retries" },
    { label: "Jobs being retried", value: h.jobs.FAILED ?? 0, bad: false, hint: "will run again" },
    { label: "Webhook deliveries failed (24 h)", value: h.webhookFailed24h, bad: h.webhookFailed24h > 0, hint: "the receiver did not accept them" },
    { label: "Messages not delivered (24 h)", value: h.messagesFailed24h, bad: h.messagesFailed24h > 0, hint: `${h.messagesSuppressed24h} more held back for missing consent` },
    { label: "Imports failed (24 h)", value: h.importsFailed24h, bad: h.importsFailed24h > 0, hint: "see Import" },
  ];
  return (
    <div>
      <SetupHeader
        entry={entry}
        actions={
          ctx.isAdmin ? (
            <Link href="/admin/jobs" className="crm-btn crm-btn-secondary">
              Automation run log
            </Link>
          ) : null
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="health-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="crm-card p-4">
            <div className="flex items-center justify-between text-sm text-text-muted">
              {t.label} <StatusPill tone={t.bad ? "danger" : "success"}>{t.bad ? "Check" : "OK"}</StatusPill>
            </div>
            <div className="text-2xl font-bold">{t.value}</div>
            <div className="text-xs text-text-muted">{t.hint}</div>
          </div>
        ))}
      </div>
      <Section title="Latest failed jobs" hint={`Last job finished: ${fmtDateTime(h.lastJobFinishedAt)}`}>
        {h.failedJobs.length === 0 ? (
          <p className="text-text-muted">No failed jobs.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {h.failedJobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{fmtDateTime(j.createdAt)}</TableCell>
                  <TableCell>{j.type}</TableCell>
                  <TableCell>{j.status === "DEAD" ? "Gave up" : "Retrying"}</TableCell>
                  <TableCell>{j.attempts}</TableCell>
                  <TableCell className="max-w-96 truncate" title={j.lastError ?? undefined}>
                    {j.lastError ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
