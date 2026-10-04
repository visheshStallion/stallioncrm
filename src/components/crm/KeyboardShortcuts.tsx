"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Global keyboard conventions (prompt 17 §5):
 *   Ctrl/⌘+K search (GlobalSearch) · c create in current module · e edit record · / focus filter search ·
 *   j / k next / previous record (RecordNav).
 * Pages opt in with data attributes: [data-shortcut="create"], [data-shortcut="edit"], [data-shortcut="filter"],
 * [data-shortcut="next"], [data-shortcut="prev"].
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const map: Record<string, string> = { c: "create", e: "edit", "/": "filter", j: "next", k: "prev" };
      const name = map[e.key];
      if (!name) return;
      const el = document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`);
      if (!el) return;
      e.preventDefault();
      if (name === "filter") el.focus();
      else el.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

const key = (module: string) => `crm:list:${module}`;

/** List pages remember the ids (in order) of the current view, so detail pages can offer previous / next. */
export function RememberListIds({ module, ids }: { module: string; ids: string[] }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(key(module), JSON.stringify(ids));
    } catch {
      /* storage unavailable */
    }
  }, [module, ids]);
  return null;
}

/** Previous / next record within the current list view (j / k). */
export function RecordNav({ module, id, basePath }: { module: string; id: string; basePath: string }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      setIds(JSON.parse(sessionStorage.getItem(key(module)) ?? "[]") as string[]);
    } catch {
      setIds([]);
    }
  }, [module]);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const prev = ids[i - 1];
  const next = ids[i + 1];
  const btn = "flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-40";
  return (
    <div className="flex items-center gap-1" data-testid="record-nav">
      <Link href={prev ? `${basePath}/${prev}` : "#"} aria-disabled={!prev} data-shortcut="prev" className={btn} aria-label="Previous record" onClick={(e) => (prev ? (e.preventDefault(), router.push(`${basePath}/${prev}`)) : e.preventDefault())}>
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <span className="text-xs text-text-muted">
        {i + 1} / {ids.length}
      </span>
      <Link href={next ? `${basePath}/${next}` : "#"} aria-disabled={!next} data-shortcut="next" className={btn} aria-label="Next record" onClick={(e) => (next ? (e.preventDefault(), router.push(`${basePath}/${next}`)) : e.preventDefault())}>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
