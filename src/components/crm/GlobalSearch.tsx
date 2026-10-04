"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { cn } from "@/lib/utils";

interface Hit {
  module: string;
  id: string;
  title: string;
  subtitle: string | null;
  brandId: string | null;
  href: string;
}

const MODULE_LABELS: Record<string, string> = { leads: "Leads", deals: "Deals", contacts: "Contacts", accounts: "Accounts", cases: "Cases", activities: "Activities", quotes: "Quotes", salesOrders: "Sales orders", invoices: "Invoices", products: "Products", inventory: "Vehicle stock" };

/**
 * Global search / command palette (Ctrl/⌘+K). Results come from /api/v1/search, which only searches
 * through the brand-scoped client – nothing outside the user's access is ever returned.
 */
export function GlobalSearch({ brands }: { brands: Array<{ id: string; code: string; color: string | null }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(((await res.json()) as { data: Hit[] }).data);
          setActive(0);
        }
      } catch {
        /* aborted */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const grouped = Object.entries(
    hits.reduce<Record<string, Hit[]>>((acc, h) => ((acc[h.module] ??= []).push(h), acc), {}),
  );
  const flat = grouped.flatMap(([, list]) => list);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-white/0 bg-muted px-3 text-left text-[13px] text-text-muted hover:border-border"
        aria-label="Search (Ctrl+K)"
        data-testid="global-search"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-border bg-surface px-1.5 text-[10px]">Ctrl K</kbd>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
          <button type="button" aria-label="Close search" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 text-text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, flat.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  }
                  if (e.key === "Enter") go(flat[active]?.href ?? `/search?q=${encodeURIComponent(q)}`);
                }}
                placeholder="Search leads, deals, customers…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
                aria-label="Search query"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="global-search-results"
              />
            </div>
            <div id="global-search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1" data-testid="search-palette-results">
              {grouped.map(([module, list]) => (
                <div key={module}>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase text-text-muted">{MODULE_LABELS[module] ?? module}</div>
                  {list.map((h) => {
                    const idx = flat.indexOf(h);
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={idx === active}
                        key={`${h.module}:${h.id}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h.href)}
                        className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", idx === active && "bg-muted")}
                      >
                        <BrandBadge brand={brands.find((b) => b.id === h.brandId)} />
                        <span className="font-medium">{h.title}</span>
                        <span className="truncate text-xs text-text-muted">{h.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {q.trim().length >= 2 && hits.length === 0 ? <p className="p-3 text-sm text-text-muted">No results.</p> : null}
              {q.trim().length >= 2 ? (
                <button type="button" onClick={() => go(`/search?q=${encodeURIComponent(q)}`)} className="w-full rounded px-2 py-1.5 text-left text-xs text-primary hover:bg-muted">
                  See all results for “{q}”
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
