"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { saveReportAction } from "@/server/modules/reports/actions";
import { CHART_TYPES, DATE_PRESETS, GRANULARITIES, isNumeric, PRESET_LABELS, REPORT_MODULES, SUMMARY_FNS, type RField } from "@/server/modules/reports/catalog";

interface Filter {
  field: string;
  op: string;
  value: string;
}
export interface ReportDraft {
  id?: string;
  name: string;
  description: string;
  folder: "PRIVATE" | "BRAND" | "GROUP";
  brandId: string;
  module: string;
  columns: string[];
  filters: Filter[];
  dateField: string;
  datePreset: string;
  from: string;
  to: string;
  groupBy: Array<{ field: string; granularity?: string }>;
  summaries: Array<{ fn: string; field?: string }>;
  chart: string;
  sortField: string;
  sortDir: "asc" | "desc";
}

const OP_LABELS: Record<string, string> = { eq: "is", neq: "is not", in: "is one of", contains: "contains", gt: ">", gte: "≥", lt: "<", lte: "≤", isEmpty: "is empty", notEmpty: "is not empty" };
const opsFor = (f?: RField) => (!f ? ["eq"] : isNumeric(f) || f.type === "date" ? ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "notEmpty"] : f.type === "enum" ? ["eq", "neq", "in", "isEmpty", "notEmpty"] : ["eq", "neq", "contains", "in", "isEmpty", "notEmpty"]);
const FN_LABELS: Record<string, string> = { count: "Count of records", sum: "Sum of", avg: "Average of", min: "Minimum of", max: "Maximum of" };

/**
 * Report builder (prompt 09): module with its related fields (account, model, activities), columns, filters,
 * date range, grouping (up to 3 levels), summaries, chart and the folder to save to.
 */
export function ReportBuilder({ initial, brands }: { initial: ReportDraft; brands: Array<{ id: string; label: string }> }) {
  const [r, setR] = useState(initial);
  const mod = REPORT_MODULES.find((m) => m.key === r.module) ?? REPORT_MODULES[0]!;
  const fields = mod.fields;
  const field = (k: string) => fields.find((f) => f.key === k);
  const set = (patch: Partial<ReportDraft>) => setR((x) => ({ ...x, ...patch }));
  const dateFields = fields.filter((f) => f.type === "date");
  const numericFields = fields.filter(isNumeric);
  const grouped = r.groupBy.length > 0;

  const payload = JSON.stringify({
    name: r.name,
    description: r.description,
    folder: r.folder,
    brandId: r.folder === "BRAND" ? r.brandId : null,
    definition: {
      module: r.module,
      columns: grouped ? [] : r.columns,
      filters: r.filters.map((f) => ({ field: f.field, op: f.op, ...(f.op === "isEmpty" || f.op === "notEmpty" ? {} : { value: f.value }) })),
      ...(r.dateField && r.datePreset !== "ALL" ? { dateRange: { field: r.dateField, preset: r.datePreset, ...(r.datePreset === "CUSTOM" ? { from: r.from, to: r.to } : {}) } } : {}),
      groupBy: r.groupBy.map((g) => ({ field: g.field, ...(field(g.field)?.type === "date" ? { granularity: g.granularity ?? "month" } : {}) })),
      summaries: grouped ? r.summaries.map((s) => (s.fn === "count" ? { fn: "count" } : { fn: s.fn, field: s.field })) : [],
      ...(!grouped && r.sortField ? { sort: { field: r.sortField, dir: r.sortDir } } : {}),
      chart: { type: grouped ? r.chart : "none" },
    },
  });

  const box = "rounded-lg border border-border bg-surface";
  const head = "border-b border-border px-4 py-2.5 text-[13px] font-semibold";
  const toggleColumn = (k: string) => set({ columns: r.columns.includes(k) ? r.columns.filter((c) => c !== k) : [...r.columns, k] });

  return (
    <ActionForm action={saveReportAction} className="space-y-4">
      {r.id ? <input type="hidden" name="id" value={r.id} /> : null}
      <input type="hidden" name="payload" value={payload} />

      <section className={box}>
        <h2 className={head}>Report</h2>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={r.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="module">Module</Label>
            <Select
              id="module"
              className="w-full"
              value={r.module}
              onChange={(e) => {
                const m = REPORT_MODULES.find((x) => x.key === e.target.value)!;
                set({ module: m.key, columns: m.defaultColumns, filters: [], groupBy: [], summaries: [{ fn: "count" }], dateField: "createdAt", sortField: m.defaultSort });
              }}
            >
              {REPORT_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-text-muted">Related records (account, model, activities) are available as fields.</p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={r.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="folder">Folder</Label>
            <Select id="folder" className="w-full" value={r.folder} onChange={(e) => set({ folder: e.target.value as ReportDraft["folder"] })}>
              <option value="PRIVATE">Private – only me</option>
              <option value="BRAND">Brand – everyone in one of my brands</option>
              <option value="GROUP">Group – everyone</option>
            </Select>
            <p className="text-xs text-text-muted">Sharing never widens access: everyone sees only the records they may see.</p>
          </div>
          {r.folder === "BRAND" ? (
            <div className="space-y-1">
              <Label htmlFor="brandId">Share with brand</Label>
              <Select id="brandId" className="w-full" value={r.brandId} onChange={(e) => set({ brandId: e.target.value })} required>
                <option value="">Choose brand…</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      </section>

      <section className={box} data-testid="report-filters">
        <h2 className={head}>Filters</h2>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="dateField">Date range on</Label>
              <Select id="dateField" value={r.dateField} onChange={(e) => set({ dateField: e.target.value })}>
                {dateFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="datePreset">Period</Label>
              <Select id="datePreset" value={r.datePreset} onChange={(e) => set({ datePreset: e.target.value })}>
                {DATE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </option>
                ))}
              </Select>
            </div>
            {r.datePreset === "CUSTOM" ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="from">From</Label>
                  <Input id="from" type="date" value={r.from} onChange={(e) => set({ from: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to">To</Label>
                  <Input id="to" type="date" value={r.to} onChange={(e) => set({ to: e.target.value })} />
                </div>
              </>
            ) : null}
          </div>
          <ul className="space-y-2">
            {r.filters.map((f, i) => {
              const def = field(f.field);
              const update = (patch: Partial<Filter>) => set({ filters: r.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Select value={f.field} aria-label="Filter field" onChange={(e) => update({ field: e.target.value, op: opsFor(field(e.target.value))[0]!, value: "" })}>
                    {fields.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                  <Select value={f.op} aria-label="Filter operator" onChange={(e) => update({ op: e.target.value })}>
                    {opsFor(def).map((o) => (
                      <option key={o} value={o}>
                        {OP_LABELS[o]}
                      </option>
                    ))}
                  </Select>
                  {f.op === "isEmpty" || f.op === "notEmpty" ? null : def?.options && f.op !== "in" ? (
                    <Select value={f.value} aria-label="Filter value" onChange={(e) => update({ value: e.target.value })}>
                      <option value="">Choose…</option>
                      {def.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input className="w-52" aria-label="Filter value" type={def?.type === "date" ? "date" : def && isNumeric(def) ? "number" : "text"} value={f.value} placeholder={f.op === "in" ? "A, B, C" : ""} onChange={(e) => update({ value: e.target.value })} />
                  )}
                  <button type="button" onClick={() => set({ filters: r.filters.filter((_, j) => j !== i) })} aria-label="Remove filter" className="text-text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button type="button" size="sm" variant="ghost" onClick={() => set({ filters: [...r.filters, { field: fields[0]!.key, op: "eq", value: "" }] })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add filter
          </Button>
        </div>
      </section>

      <section className={box} data-testid="report-grouping">
        <h2 className={head}>Grouping and summaries</h2>
        <div className="space-y-3 p-4">
          <ul className="space-y-2">
            {r.groupBy.map((g, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-xs text-text-muted">Level {i + 1}</span>
                <Select value={g.field} aria-label={`Group level ${i + 1}`} onChange={(e) => set({ groupBy: r.groupBy.map((x, j) => (j === i ? { field: e.target.value, granularity: "month" } : x)) })}>
                  {fields
                    .filter((f) => !isNumeric(f) || f.key === g.field)
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </Select>
                {field(g.field)?.type === "date" ? (
                  <Select value={g.granularity ?? "month"} aria-label="Date grouping" onChange={(e) => set({ groupBy: r.groupBy.map((x, j) => (j === i ? { ...x, granularity: e.target.value } : x)) })}>
                    {GRANULARITIES.map((x) => (
                      <option key={x} value={x}>
                        by {x}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <button type="button" onClick={() => set({ groupBy: r.groupBy.filter((_, j) => j !== i) })} aria-label="Remove grouping" className="text-text-muted hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {r.groupBy.length < 3 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => set({ groupBy: [...r.groupBy, { field: fields.find((f) => !isNumeric(f) && !r.groupBy.some((g) => g.field === f.key))?.key ?? fields[0]!.key }], summaries: r.summaries.length ? r.summaries : [{ fn: "count" }] })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add grouping level
            </Button>
          ) : null}
          {grouped ? (
            <>
              <ul className="space-y-2">
                {r.summaries.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Select value={s.fn} aria-label="Summary function" onChange={(e) => set({ summaries: r.summaries.map((x, j) => (j === i ? { fn: e.target.value, field: e.target.value === "count" ? undefined : (x.field ?? numericFields[0]?.key) } : x)) })}>
                      {SUMMARY_FNS.map((fn) => (
                        <option key={fn} value={fn}>
                          {FN_LABELS[fn]}
                        </option>
                      ))}
                    </Select>
                    {s.fn !== "count" ? (
                      <Select value={s.field ?? ""} aria-label="Summary field" onChange={(e) => set({ summaries: r.summaries.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                        {numericFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    <button type="button" onClick={() => set({ summaries: r.summaries.filter((_, j) => j !== i) })} aria-label="Remove summary" className="text-text-muted hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {r.summaries.length < 6 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => set({ summaries: [...r.summaries, { fn: "sum", field: numericFields[0]?.key }] })}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add summary
                </Button>
              ) : null}
              <div className="flex items-center gap-2">
                <Label htmlFor="chart">Chart</Label>
                <Select id="chart" value={r.chart} onChange={(e) => set({ chart: e.target.value })}>
                  {CHART_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {c === "none" ? "No chart" : c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-text-muted">The chart uses the first grouping level (and the second as series) with the first summary.</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">Without grouping the report lists the records with the columns below.</p>
          )}
        </div>
      </section>

      {!grouped ? (
        <section className={box} data-testid="report-columns">
          <h2 className={head}>Columns</h2>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Columns">
              {fields.map((f) => {
                const on = r.columns.includes(f.key);
                return (
                  <button key={f.key} type="button" aria-pressed={on} onClick={() => toggleColumn(f.key)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="sortField">Sort by</Label>
              <Select id="sortField" value={r.sortField} onChange={(e) => set({ sortField: e.target.value })}>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <Select value={r.sortDir} aria-label="Sort direction" onChange={(e) => set({ sortDir: e.target.value as "asc" | "desc" })}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </Select>
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={r.id ? `/reports/${r.id}` : "/reports"}>Cancel</Link>
        </Button>
        <SubmitButton>Save and Run</SubmitButton>
      </div>
    </ActionForm>
  );
}
