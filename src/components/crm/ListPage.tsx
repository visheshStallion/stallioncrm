"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Filter, LayoutGrid, List, PanelLeftClose, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { encodeCondition, OP_LABELS, OPS_BY_TYPE, PAGE_SIZES, type Condition, type FieldDef, type FilterOp } from "@/server/list/filters";
import { DropdownMenu, MenuItem } from "./overlays";
import { PrintViewItem } from "./PrintActions";

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
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="crm-view-title" data-testid="view-selector">
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
                <div className="crm-menu-title">{g === "system" ? "System views" : "My views"}</div>
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
  return (
    <div className="crm-segment" role="group" aria-label="Layout">
      <Link href={href("list")} aria-current={layout === "list" ? "page" : undefined}>
        <List className="h-4 w-4" /> List
      </Link>
      <Link href={href("kanban")} aria-current={layout === "kanban" ? "page" : undefined}>
        <LayoutGrid className="h-4 w-4" /> Kanban
      </Link>
    </div>
  );
}

/** Primary "Create X" split button (arrow → Import X). */
export function CreateSplitButton({ label, href, importHref }: { label: string; href: string; importHref?: string }) {
  return (
    <div className="flex">
      <Button asChild className={cn(importHref && "crm-btn-split-main")}>
        <Link href={href} data-shortcut="create">
          {label}
        </Link>
      </Button>
      {importHref ? (
        <DropdownMenu
          label={`${label} options`}
          trigger={({ toggle, open, id }) => (
            <Button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label="More create options" className="crm-btn-split-caret">
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
      <PrintViewItem />
    </DropdownMenu>
  );
}

/** Open / closed state of the filter panel, owned by ModuleListFrame (toolbar toggle, remembered per module). */
const FilterOpen = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/**
 * Left filter panel (--w-filter, collapsible): search, system-defined filters, field filters with operators.
 * Applies by rewriting the URL (`q`, `sys`, `f=field~op~value[~value2]`). Below 1280px it lies over the table.
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
  const { sp, push, pathname } = useUrl();
  const shared = useContext(FilterOpen);
  const [localOpen, setLocalOpen] = useState(true);
  const open = shared ? shared.open : localOpen;
  const setOpen = shared ? shared.setOpen : setLocalOpen;
  const moduleLabel = (pathname.split("/")[1] ?? "records").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [sys, setSys] = useState(sp.get("sys") ?? "");
  const [fieldQuery, setFieldQuery] = useState("");
  const [conds, setConds] = useState<Record<string, Condition>>(() => Object.fromEntries(conditions.map((c) => [c.field, c])));

  if (!open) {
    // the toolbar of ModuleListFrame carries the toggle; standalone panels show their own button
    return shared ? null : (
      <Button type="button" variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Show filters" className="self-start">
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
    <aside className={cn("crm-filter", !shared && "self-start rounded-md border border-border")} aria-label="Filters" data-testid="filter-panel">
      <div className="crm-filter-title">
        <span>Filter {moduleLabel} by</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide filters" className="text-text-muted hover:text-text">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="crm-filter-scroll space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label="Search records"
            data-shortcut="filter"
          />
        </div>
        <details open className="crm-filter-section">
          <summary>System Defined Filters</summary>
          {systemFilters.map((s) => (
            <label key={s.key} className="crm-filter-row">
              <input type="radio" name="sys" checked={sys === s.key} onChange={() => setSys(s.key)} />
              {s.label}
            </label>
          ))}
          <label className="crm-filter-row">
            <input type="radio" name="sys" checked={!sys} onChange={() => setSys("")} />
            None
          </label>
        </details>
        <details open className="crm-filter-section">
          <summary>Filter By Fields</summary>
          <Input value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} placeholder="Find field" className="mb-2" aria-label="Find field" />
          <div>
            {fields
              .filter((f) => f.label.toLowerCase().includes(fieldQuery.toLowerCase()))
              .map((f) => {
                const c = conds[f.key];
                return (
                  <div key={f.key} className="rounded border border-transparent data-[on=true]:my-1 data-[on=true]:border-border data-[on=true]:p-1.5" data-on={!!c}>
                    <label className="crm-filter-row">
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
      </div>
      <div className="crm-filter-actions">
        <Button type="button" size="sm" onClick={apply}>
          Apply Filter
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={clear}>
          Clear
        </Button>
      </div>
    </aside>
  );
}

function ConditionEditor({ field, c, onChange }: { field: FieldDef; c: Condition; onChange: (c: Condition) => void }) {
  const noValue = c.op === "isEmpty" || c.op === "isNotEmpty";
  return (
    <div className="mt-1 space-y-1 pl-5">
      <Select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as FilterOp })} className="crm-btn-sm w-full" aria-label={`${field.label} operator`}>
        {OPS_BY_TYPE[field.type].map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </Select>
      {noValue ? null : field.type === "enum" || field.type === "boolean" ? (
        <Select value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} className="crm-btn-sm w-full" aria-label={`${field.label} value`}>
          <option value="">Choose…</option>
          {(field.type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : c.op === "between" ? (
        <div className="flex gap-1">
          <Input type={field.type === "date" ? "date" : "number"} value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} className="crm-btn-sm" aria-label={`${field.label} from`} />
          <Input type={field.type === "date" ? "date" : "number"} value={c.value2 ?? ""} onChange={(e) => onChange({ ...c, value2: e.target.value })} className="crm-btn-sm" aria-label={`${field.label} to`} />
        </div>
      ) : (
        <Input
          type={c.op === "lastNDays" || field.type === "number" ? "number" : "text"}
          value={c.value ?? ""}
          onChange={(e) => onChange({ ...c, value: e.target.value })}
          placeholder={c.op === "lastNDays" ? "days" : ""}
          className="crm-btn-sm"
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
    <div className="crm-table-footer crm-flush" data-testid="pagination">
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
          className="crm-btn-sm"
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

/** Below this width the filter panel is an overlay and starts closed. */
const FILTER_OVERLAY_BELOW = 1280;

/**
 * ModuleListPage frame: toolbar (filter toggle, view selector, actions), filter panel and the table area, edge to
 * edge. Whether the filter panel is open is remembered per module (in the browser).
 */
export function ModuleListFrame({ title, actions, filters, children }: { title: ReactNode; actions: ReactNode; filters?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const storageKey = `crm:filter-open:${pathname.split("/")[1] ?? ""}`;
  const [open, setOpenState] = useState(true);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      /* storage blocked: use the default */
    }
    setOpenState(stored === null ? window.innerWidth >= FILTER_OVERLAY_BELOW : stored === "1");
  }, [storageKey]);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  return (
    <FilterOpen.Provider value={{ open, setOpen }}>
      <div className="crm-list" data-testid="module-list-page">
        <div className="crm-toolbar">
          {filters ? (
            <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(!open)} aria-label={open ? "Hide filters" : "Show filters"} aria-pressed={open} data-testid="filter-toggle">
              <Filter className="h-4 w-4" />
            </Button>
          ) : null}
          {title}
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="crm-list-body">
          {filters}
          <div className="crm-list-content">{children}</div>
        </div>
      </div>
    </FilterOpen.Provider>
  );
}
