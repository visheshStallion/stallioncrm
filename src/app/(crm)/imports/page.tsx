import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageTitleRow, StatusPill, type Tone } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { undoImportAction, uploadImportAction } from "@/server/modules/imports/actions";
import { IMPORT_MODULES } from "@/server/modules/imports/plan";
import { canImport, listImports } from "@/server/modules/imports/service";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Import data" };
const TONE: Record<string, Tone> = { DRAFT: "neutral", QUEUED: "info", RUNNING: "warning", DONE: "success", FAILED: "danger", UNDONE: "neutral" };

/** Import wizard start + history (prompt 12). Brand Managers import into their own brand, administrators anywhere. */
export default async function ImportsPage() {
  const ctx = await requireContext();
  if (!canImport(ctx)) forbidden();
  const [jobs, prefs] = await Promise.all([listImports(ctx), getPreferences(ctx)]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow title="Import data" left={<span className="text-[13px] text-text-muted">{ctx.isAdmin ? "any brand" : "your own brand only"} · CSV or XLSX · up to 5,000 rows</span>} />
      <section className="mb-4 rounded-lg border border-border bg-surface p-4" data-testid="import-upload">
        <h2 className="mb-2 text-[13px] font-semibold">1. Upload a file</h2>
        <ActionForm action={uploadImportAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="module">Module</Label>
            <Select id="module" name="module" required defaultValue="leads">
              {IMPORT_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="file">File (first row = column names)</Label>
            <Input id="file" name="file" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="w-80" />
          </div>
          <SubmitButton>Upload</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-text-muted">Nothing is written until you have checked the dry run. The uploaded rows are deleted when the import has run.</p>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Import history</h2>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <table className="w-full text-[13px]" data-testid="import-history">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const s = (j.summary ?? null) as { created?: number; updated?: number; skipped?: number; failed?: number } | null;
                return (
                  <tr key={j.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/imports/${j.id}`} className="font-medium text-primary hover:underline">
                        {j.fileName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{IMPORT_MODULES.find((m) => m.key === j.module)?.label ?? j.module}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={TONE[j.status]}>{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{s ? `${s.created ?? 0} created · ${s.updated ?? 0} updated · ${s.skipped ?? 0} skipped · ${s.failed ?? 0} failed` : "—"}</td>
                    <td className="px-3 py-2">{j.user.name}</td>
                    <td className="px-3 py-2">{formatDateTime(j.createdAt, prefs.dateFormat)}</td>
                    <td className="px-3 py-2 text-right">
                      {j.status === "DONE" && j.userId === ctx.userId ? (
                        <ActionForm action={undoImportAction} confirm="Undo this import? The records it created are deleted.">
                          <input type="hidden" name="id" value={j.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Undo
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
