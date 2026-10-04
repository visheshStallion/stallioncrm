"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Filter, LayoutGrid, List, PanelLeftClose, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { encodeCondition, OP_LABELS, OPS_BY_TYPE, PAGE_SIZES, type Condition, type FieldDef, type FilterOp } from "@/server/list/filters";
import { DropdownMenu, MenuItem } from "./overlays";

function useUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mutate(p);
    router.push(`${pathname}?${p.toString()}`);
  };
  return { sp, push, pathname };
}

export interface ViewOption {
  id: string;
  name: string;
  group: "system" | "mine";
}

/** "All Leads ▾" view selector: system views, my views, + New custom view (save current). */
export function ViewSelector({ views, current, onSaveCurrent }: { views: ViewOption[]; current: string; onSaveCurrent?: () => void }) {
  const { push } = useUrl();
  const active = views.find((v) => v.id === current) ?? views[0];
  return (
    <DropdownMenu
      label="Views"
      align="left"
      trigger={({ toggle, open, id }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="flex items-center gap-1 rounded-md px-2 py-1 text-[20px] font-semibold hover:bg-muted" data-testid="view-selector">
          {active?.name} <ChevronDown className="h-4 w-4" />
        </button>
      )}
    >
      {(close) => (
        <div data-testid="view-menu">
          {(["system", "mine"] as const).map((g) => {
            const list = views.filter((v) => v.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase text-text-muted">{g === "system" ? "System views" : "My views"}</div>
                {list.map((v) => (
                  <MenuItem
                    key={v.id}
                    onClick={() => {
                      close();
                      push((p) => {
                        ["view", "f", "sys", "page", "q"].forEach((k) => p.delete(k));
                        p.set("view", v.id);
                      });
                    }}
                  >
                    <span className={cn(v.id === current && "font-semibold text-primary")}>{v.name}</span>
                  </MenuItem>
                ))}
              </div>
            );
          })}
          {onSaveCurrent ? (
            <div className="mt-1 border-t border-border pt-1">
              <MenuItem
                onClick={() => {
                  close();
                  onSaveCurrent();
                }}
              >
                + New custom view (save current)
              </MenuItem>
            </div>
          ) : null}
        </div>
      )}
    </DropdownMenu>
  );
}

/** List / Kanban toggle. */
export function LayoutToggle({ layout }: { layout: "list" | "kanban" }) {
  const { sp, pathname } = useUrl();
  const href = (l: string) => {
    const p = new URLSearchParams(sp.toString());
    if (l === "list") p.delete("layout");
    else p.set("layout", l);
    p.delete("page");
    return `${pathname}?${p.toString()}`;
  };
  const cls = (on: boolean) => cn("flex h-8 items-center gap-1 px-2.5 text-[13px]", on ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted");
  return (
    <div className="flex overflow-hidden rounded-md border border-border bg-surface" role="group" aria-label="Layout">
      <Link href={href("list")} className={cls(layout === "list")} aria-current={layout === "list" ? "page" : undefined}>
        <List className="h-4 w-4" /> List
      </Link>
      <Link href={href("kanban")} className={cls(layout === "kanban")} aria-current={layout === "kanban" ? "page" : undefined}>
        <LayoutGrid className="h-4 w-4" /> Kanban
      </Link>
    </div>
  );
}

/** Primary "Create X" split button (arrow → Import X). */
export function CreateSplitButton({ label, href, importHref }: { label: string; href: string; importHref?: string }) {
  return (
    <div className="flex">
      <Button asChild className={cn(importHref && "rounded-r-none")}>
        <Link href={href} data-shortcut="create">
          {label}
        </Link>
      </Button>
      {importHref ? (
        <DropdownMenu
          label={`${label} options`}
          trigger={({ toggle, open, id }) => (
            <Button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label="More create options" className="rounded-l-none border-l border-white/30 px-2">
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        >
          <MenuItem href={importHref}>Import</MenuItem>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ActionsMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu
      label="Actions"
      trigger={({ toggle, open, id }) => (
        <Button type="button" variant="outline" onClick={toggle} aria-expanded={open} aria-controls={id}>
          Actions <ChevronDown className="h-4 w-4" />
        </Button>
      )}
    >
      {children}
    </DropdownMenu>
  );
}

/**
 * Left filter panel (260 px, collapsible): search, system-defined filters, field filters with operators.
 * Applies by rewriting the URL (`q`, `sys`, `f=field~op~value[~value2]`).
 */
export function FilterPanel({
  fields,
  conditions,
  systemFilters,
  searchPlaceholder = "Search",
}: {
  fields: FieldDef[];
  conditions: Condition[];
  systemFilters: Array<{ key: string; label: string }>;
  searchPlaceholder?: string;
}) {
  const { sp, push } = useUrl();
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [sys, setSys] = useState(sp.get("sys") ?? "");
  const [fieldQuery, setFieldQuery] = useState("");
  const [conds, setConds] = useState<Record<string, Condition>>(() => Object.fromEntries(conditions.map((c) => [c.field, c])));

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Show filters" className="self-start">
        <Filter className="h-4 w-4" />
      </Button>
    );
  }

  const apply = () =>
    push((p) => {
      p.delete("f");
      p.delete("page");
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      if (sys) p.set("sys", sys);
      else p.delete("sys");
      for (const c of Object.values(conds)) p.append("f", encodeCondition(c));
    });
  const clear = () => {
    setQ("");
    setSys("");
    setConds({});
    push((p) => ["q", "sys", "f", "page"].forEach((k) => p.delete(k)));
  };

  return (
    <aside className="w-[260px] shrink-0 self-start rounded-lg border border-border bg-surface" aria-label="Filters" data-testid="filter-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold">Filter records</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide filters" className="text-text-muted hover:text-text">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 p-3 text-[13px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder={searchPlaceholder}
            className="h-9 pl-8"
            aria-label="Search records"
            data-shortcut="filter"
          />
        </div>
        <details open className="space-y-1">
          <summary className="cursor-pointer font-semibold">System defined filters</summary>
          {systemFilters.map((s) => (
            <label key={s.key} className="flex items-center gap-2 py-0.5">
              <input type="radio" name="sys" checked={sys === s.key} onChange={() => setSys(s.key)} />
              {s.label}
            </label>
          ))}
          <label className="flex items-center gap-2 py-0.5">
            <input type="radio" name="sys" checked={!sys} onChange={() => setSys("")} />
            None
          </label>
        </details>
        <details open>
          <summary className="cursor-pointer font-semibold">Filter by fields</summary>
          <Input value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} placeholder="Find field" className="my-2 h-8" aria-label="Find field" />
          <div className="max-h-[45vh] space-y-1 overflow-y-auto pr-1">
            {fields
              .filter((f) => f.label.toLowerCase().includes(fieldQuery.toLowerCase()))
              .map((f) => {
                const c = conds[f.key];
                return (
                  <div key={f.key} className="rounded border border-transparent py-0.5 data-[on=true]:border-border data-[on=true]:p-1.5" data-on={!!c}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!c}
                        onChange={() =>
                          setConds((all) => {
                            const n = { ...all };
                            if (n[f.key]) delete n[f.key];
                            else n[f.key] = { field: f.key, op: OPS_BY_TYPE[f.type][0]! };
                            return n;
                          })
                        }
                      />
                      {f.label}
                    </label>
                    {c ? <ConditionEditor field={f} c={c} onChange={(next) => setConds((all) => ({ ...all, [f.key]: next }))} /> : null}
                  </div>
                );
              })}
          </div>
        </details>
        <div className="flex gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" onClick={apply}>
            Apply filter
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ConditionEditor({ field, c, onChange }: { field: FieldDef; c: Condition; onChange: (c: Condition) => void }) {
  const noValue = c.op === "isEmpty" || c.op === "isNotEmpty";
  return (
    <div className="mt-1 space-y-1 pl-5">
      <Select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as FilterOp })} className="h-7 w-full text-xs" aria-label={`${field.label} operator`}>
        {OPS_BY_TYPE[field.type].map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </Select>
      {noValue ? null : field.type === "enum" || field.type === "boolean" ? (
        <Select value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} className="h-7 w-full text-xs" aria-label={`${field.label} value`}>
          <option value="">Choose…</option>
          {(field.type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : c.op === "between" ? (
        <div className="flex gap-1">
          <Input type={field.type === "date" ? "date" : "number"} value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} className="h-7 text-xs" aria-label={`${field.label} from`} />
          <Input type={field.type === "date" ? "date" : "number"} value={c.value2 ?? ""} onChange={(e) => onChange({ ...c, value2: e.target.value })} className="h-7 text-xs" aria-label={`${field.label} to`} />
        </div>
      ) : (
        <Input
          type={c.op === "lastNDays" || field.type === "number" ? "number" : "text"}
          value={c.value ?? ""}
          onChange={(e) => onChange({ ...c, value: e.target.value })}
          placeholder={c.op === "lastNDays" ? "days" : ""}
          className="h-7 text-xs"
          aria-label={`${field.label} value`}
        />
      )}
    </div>
  );
}

/** "Total Records N  ◂ 1 – 20 ▸  20 ▾ records per page" */
export function Pagination({ total, page, per }: { total: number; page: number; per: number }) {
  const { push } = useUrl();
  const from = total === 0 ? 0 : (page - 1) * per + 1;
  const to = Math.min(page * per, total);
  const go = (p: number) => push((s) => s.set("page", String(p)));
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-muted" data-testid="pagination">
      <span>
        Total Records <strong className="text-text" data-testid="total-records">{total}</strong>
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>
          {from} – {to}
        </span>
        <Button size="icon" variant="ghost" disabled={to >= total} onClick={() => go(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <label className="flex items-center gap-1">
        <Select
          value={String(per)}
          onChange={(e) =>
            push((s) => {
              s.set("per", e.target.value);
              s.delete("page");
            })
          }
          className="h-8 text-[13px]"
          aria-label="Records per page"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        records per page
      </label>
    </div>
  );
}

/** ModuleListPage frame: title row (view selector + actions) and filter panel + content. */
export function ModuleListFrame({ title, actions, filters, children }: { title: ReactNode; actions: ReactNode; filters?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="module-list-page">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {title}
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="flex items-start gap-3">
        {filters}
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}
