import Link from "next/link";
import { EmptyState, PageTitleRow, StatusPill, type Tone } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { can } from "@/server/access/can";
import { EXPORT_MODULES, EXPORT_SYNC_LIMIT, listExports } from "@/server/modules/exports/service";
import { canImport } from "@/server/modules/imports/service";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Exports" };
const TONE: Record<string, Tone> = { QUEUED: "info", RUNNING: "warning", DONE: "success", FAILED: "danger", EXPIRED: "neutral" };

/** Export centre (prompt 12): module exports the caller is allowed to run, their queued exports, admin backup. */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  const [{ queued }, ctx] = await Promise.all([searchParams, requireContext()]);
  const [jobs, prefs] = await Promise.all([listExports(ctx), getPreferences(ctx)]);
  const modules = EXPORT_MODULES.filter((m) => can(ctx, m.key, "export"));
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageTitleRow title="Exports" left={<span className="text-[13px] text-text-muted">only the records you can see · masked fields stay masked · every export is audited</span>} />
      {queued ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-[13px]" data-testid="export-queued">
          That export is large, so it runs in the background. You get a notification when the file is ready.
        </p>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-4" data-testid="export-modules">
        <h2 className="mb-2 text-[13px] font-semibold">Export a module</h2>
        {modules.length === 0 ? (
          <p className="text-[13px] text-text-muted">Your profile has no export permission.</p>
        ) : (
          <ul className="grid gap-2 text-[13px] sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="font-medium">{m.label}</span>
                <span className="flex gap-3">
                  <a href={`/api/v1/export/${m.key}?format=csv`} className="text-primary hover:underline">
                    CSV
                  </a>
                  <a href={`/api/v1/export/${m.key}?format=xlsx`} className="text-primary hover:underline">
                    XLSX
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-text-muted">
          Up to {EXPORT_SYNC_LIMIT.toLocaleString("en-NG")} rows download straight away; larger exports are prepared in the background. Filtered views can be exported from the list pages.
          {canImport(ctx) ? (
            <>
              {" "}
              <Link href="/imports" className="text-primary underline">
                Import data
              </Link>
            </>
          ) : null}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">My background exports</h2>
        {jobs.length === 0 ? (
          <EmptyState title="No background exports" />
        ) : (
          <table className="w-full text-[13px]" data-testid="export-jobs">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Format</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rows</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{EXPORT_MODULES.find((m) => m.key === j.module)?.label ?? (j.module.startsWith("print:") ? `Printout – ${j.module.slice(6)}` : j.module.startsWith("send:") ? `Documents sent – ${j.module.slice(5)} (report)` : j.module)}</td>
                  <td className="px-3 py-2 uppercase">{j.format}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={TONE[j.expired ? "EXPIRED" : j.status]}>{j.expired ? "Expired" : j.status.charAt(0) + j.status.slice(1).toLowerCase()}</StatusPill>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{j.rowCount ?? "—"}</td>
                  <td className="px-3 py-2">{formatDateTime(j.createdAt, prefs.dateFormat)}</td>
                  <td className="px-3 py-2 text-right">
                    {j.available ? (
                      <a href={`/api/v1/exports/${j.id}/download`} className="text-primary hover:underline">
                        Download (until {formatDateTime(j.expiresAt!, prefs.dateFormat)})
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {ctx.isSuperAdmin ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="backup">
          <h2 className="mb-1 text-[13px] font-semibold">Full backup (all brands)</h2>
          <p className="mb-3 text-xs text-text-muted">
            One CSV per table in a zip, encrypted with AES-256-GCM from your passphrase. The passphrase is not stored – without it the file cannot be opened. Decrypt with <code>pnpm backup:decrypt</code>.
          </p>
          <form method="post" action="/api/v1/admin/backup" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="passphrase">Passphrase (at least 12 characters)</Label>
              <Input id="passphrase" name="passphrase" type="password" required minLength={12} autoComplete="new-password" className="w-72" />
            </div>
            <Button type="submit" variant="outline">
              Download encrypted backup
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
