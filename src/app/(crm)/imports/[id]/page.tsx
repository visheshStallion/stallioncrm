import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isAccessError } from "@/server/access/errors";
import { applyTemplateAction, commitImportAction, discardImportAction, saveMappingAction, saveTemplateAction, undoImportAction } from "@/server/modules/imports/actions";
import { importModule, ZOHO_STAGE_MAP } from "@/server/modules/imports/plan";
import { canImport, dryRun, getImport, listMappings } from "@/server/modules/imports/service";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Import" };

/** Import wizard: 2. mapping → 3. dry run → 4. commit; afterwards the result with the row problems and undo. */
export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const [{ id }, { show }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!canImport(ctx)) forbidden();
  const job = await getImport(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound(); // imports of other users
    throw e;
  });
  const mod = importModule(job.module)!;
  const mine = job.userId === ctx.userId;

  if (job.status !== "DRAFT" || !mine) {
    const s = (job.summary ?? {}) as { total?: number; created?: number; updated?: number; skipped?: number; failed?: number; byBrand?: Record<string, number> };
    const problems = (job.problems ?? []) as Array<{ line: number; message: string }>;
    return (
      <div className="mx-auto max-w-5xl">
        <PageTitleRow title={`Import: ${job.fileName}`} left={<StatusPill tone={job.status === "DONE" ? "success" : job.status === "FAILED" ? "danger" : "info"}>{job.status.charAt(0) + job.status.slice(1).toLowerCase()}</StatusPill>} />
        <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="import-result">
          {job.status === "QUEUED" || job.status === "RUNNING" ? (
            <p>
              The import runs in the background. <Link href={`/imports/${job.id}`} className="text-primary underline">Refresh</Link> to see the result.
            </p>
          ) : (
            <>
              <p className="font-semibold">
                {s.created ?? 0} created · {s.updated ?? 0} updated · {s.skipped ?? 0} skipped · {s.failed ?? 0} failed (of {s.total ?? 0} rows)
              </p>
              {s.byBrand ? <p className="text-text-muted">By brand: {Object.entries(s.byBrand).map(([b, n]) => `${b} ${n}`).join(" · ") || "—"}</p> : null}
              {problems.length ? (
                <ul className="mt-3 space-y-1" data-testid="import-problems">
                  {problems.slice(0, 200).map((p, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs text-text-muted">row {p.line}</span> {p.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Link href="/imports" className="text-primary hover:underline">
              ← Import history
            </Link>
            {job.status === "DONE" && mine ? (
              <ActionForm action={undoImportAction} confirm="Undo this import? The records it created are deleted.">
                <input type="hidden" name="id" value={job.id} />
                <SubmitButton size="sm" variant="outline">
                  Undo import
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  const [{ plan, mapping, header }, templates, dir] = await Promise.all([dryRun(ctx, id), listMappings(ctx, job.module), getDirectory(ctx)]);
  const valueMapText = Object.entries(mapping.values).flatMap(([field, map]) => Object.entries(map).map(([from, to]) => `${field}: ${from} = ${to}`)).join("\n");
  const rows = show === "all" ? plan.rows : plan.rows.filter((r) => r.errors.length || r.warnings.length).slice(0, 100);
  const hasBrand = mod.fields.some((f) => f.key === "brand");
  const hasRegion = mod.fields.some((f) => f.key === "region");

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow title={`Import ${mod.label}: ${job.fileName}`} left={<span className="text-[13px] text-text-muted">{plan.summary.total} rows</span>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-[13px] font-semibold">2. Column and value mapping</h2>
          <ActionForm action={saveMappingAction} className="space-y-3">
            <input type="hidden" name="id" value={job.id} />
            <table className="w-full text-[13px]" data-testid="column-mapping">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase text-text-muted">
                  <th className="py-1 pr-3">Column in the file</th>
                  <th className="py-1">Field in the CRM</th>
                </tr>
              </thead>
              <tbody>
                {header.map((h) => (
                  <tr key={h} className="border-b border-border last:border-0">
                    <td className="py-1 pr-3">
                      <label htmlFor={`col-${h}`}>{h}</label>
                    </td>
                    <td className="py-1">
                      <Select id={`col-${h}`} name={`col:${h}`} defaultValue={mapping.columns[h] ?? ""} className="w-64">
                        <option value="">— ignore —</option>
                        {mod.fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="dedupe">When a record already exists</Label>
                <Select id="dedupe" name="dedupe" defaultValue={mapping.dedupe} className="w-full">
                  <option value="skip">Skip the row</option>
                  <option value="update">Update the existing record</option>
                  <option value="create">Create a duplicate</option>
                </Select>
              </div>
              {hasBrand ? (
                <div className="space-y-1">
                  <Label htmlFor="defaultBrand">Brand when the file has none</Label>
                  <Select id="defaultBrand" name="defaultBrand" defaultValue={mapping.defaultBrand ?? ""} className="w-full">
                    <option value="">—</option>
                    {dir.myBrands.map((b) => (
                      <option key={b.id} value={b.code}>
                        {b.code}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {hasRegion ? (
                <div className="space-y-1">
                  <Label htmlFor="defaultRegion">Region when the file has none</Label>
                  <Select id="defaultRegion" name="defaultRegion" defaultValue={mapping.defaultRegion ?? ""} className="w-full">
                    <option value="">—</option>
                    {dir.regions.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="valueMap">Value mapping – one per line: field: value in the file = our value</Label>
              <textarea id="valueMap" name="valueMap" rows={4} defaultValue={valueMapText} placeholder={"stage: Negotiation/Review = BOOKING\nsource: Cold Call = PHONE"} className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs" />
              <p className="text-xs text-text-muted">
                Zoho stage names are mapped automatically ({Object.keys(ZOHO_STAGE_MAP).slice(0, 4).join(", ")} …); legacy company codes resolve through the brand aliases (Setup → Brands).
              </p>
            </div>
            <SubmitButton variant="outline">Save mapping and refresh dry run</SubmitButton>
          </ActionForm>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="dry-run-summary">
            <h2 className="mb-2 text-[13px] font-semibold">3. Dry run</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-text-muted">Create</dt>
              <dd className="text-right font-semibold">{plan.summary.create}</dd>
              <dt className="text-text-muted">Update</dt>
              <dd className="text-right font-semibold">{plan.summary.update}</dd>
              <dt className="text-text-muted">Skip</dt>
              <dd className="text-right">{plan.summary.skip}</dd>
              <dt className="text-text-muted">Rows with warnings</dt>
              <dd className="text-right">{plan.summary.warnings}</dd>
              <dt className="text-text-muted">Rows with errors</dt>
              <dd className={cn("text-right font-semibold", plan.summary.errors > 0 && "text-danger")}>{plan.summary.errors}</dd>
            </dl>
            <p className="mt-2 text-xs text-text-muted">Brand resolved per row: {Object.entries(plan.summary.byBrand).map(([b, n]) => `${b} ${n}`).join(" · ") || "—"}</p>
            {plan.missingRequired.length ? <p className="mt-2 text-xs font-semibold text-danger">Map these required fields: {plan.missingRequired.join(", ")}</p> : null}
            <ActionForm action={commitImportAction} confirm={`Import ${plan.summary.create + plan.summary.update} rows? Rows with errors are left out.`} className="mt-3">
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton disabled={plan.missingRequired.length > 0 || plan.summary.create + plan.summary.update === 0}>4. Start import</SubmitButton>
            </ActionForm>
            <ActionForm action={discardImportAction} confirm="Discard this upload?" className="mt-2">
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton size="sm" variant="ghost">
                Discard
              </SubmitButton>
            </ActionForm>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 text-[13px]">
            <h2 className="mb-2 font-semibold">Mapping templates</h2>
            {templates.length ? (
              <ActionForm action={applyTemplateAction} className="mb-3 flex items-end gap-2">
                <input type="hidden" name="id" value={job.id} />
                <Select name="mappingId" aria-label="Mapping template" required defaultValue="" className="min-w-0 flex-1">
                  <option value="">Choose template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <SubmitButton size="sm" variant="outline">
                  Apply
                </SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={saveTemplateAction} className="flex items-end gap-2">
              <input type="hidden" name="id" value={job.id} />
              <Input name="name" placeholder="e.g. Zoho Deals export" aria-label="Template name" required maxLength={80} className="min-w-0 flex-1" />
              <SubmitButton size="sm" variant="outline">
                Save as template
              </SubmitButton>
            </ActionForm>
          </section>
        </aside>
      </div>

      <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Rows {show === "all" ? "(all)" : "with warnings or errors"}</h2>
          <Link href={`/imports/${job.id}${show === "all" ? "" : "?show=all"}`} className="text-xs text-primary hover:underline">
            {show === "all" ? "Show only problems" : "Show all rows"}
          </Link>
        </header>
        {rows.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">No problems found.</p>
        ) : (
          <table className="w-full text-[13px]" data-testid="dry-run-rows">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r) => (
                <tr key={r.line} className="border-b border-border align-top last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.line}</td>
                  <td className="px-3 py-1.5">{r.brand ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <StatusPill tone={r.errors.length ? "danger" : r.action === "skip" ? "neutral" : r.action === "update" ? "info" : "success"}>{r.errors.length ? "error" : r.action}</StatusPill>
                  </td>
                  <td className="px-3 py-1.5">{String(r.values.name ?? r.values.lastName ?? r.values.subject ?? r.values.code ?? r.values.productCode ?? "")}</td>
                  <td className="px-3 py-1.5">
                    {r.errors.map((e, i) => (
                      <div key={`e${i}`} className="text-danger">
                        {e}
                      </div>
                    ))}
                    {r.warnings.map((w, i) => (
                      <div key={`w${i}`} className="text-text-muted">
                        {w}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
