"use client";

import { Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";

export interface SetupItem {
  key: string;
  href: string;
  label: string;
  description?: string;
  /** DONE | PARTIAL | PLANNED – planned functions open a "Coming soon" page */
  status?: "DONE" | "PARTIAL" | "PLANNED";
  superAdminOnly?: boolean;
}

export interface SetupCategory {
  key: string;
  title: string;
  description: string;
  items: SetupItem[];
}

const RECENT_KEY = "crm:setup:recent";
const HOME_PATHS = ["/setup", "/admin"];

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function StatusTag({ item }: { item: SetupItem }) {
  return (
    <>
      {item.superAdminOnly ? (
        <span className="crm-pill border-border-strong text-text-muted" title="Super Admin only">
          SA
        </span>
      ) : null}
      {item.status === "PLANNED" ? (
        <span className="crm-pill border-border-strong text-text-muted" title="Planned – the page says what will come">
          Soon
        </span>
      ) : null}
    </>
  );
}

/** Setup home: category grid, search over function names and descriptions, recently visited. */
export function SetupLanding({ categories }: { categories: SetupCategory[] }) {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  const needle = q.trim().toLowerCase();
  const visible = categories
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => !needle || i.label.toLowerCase().includes(needle) || (i.description ?? "").toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle)),
    }))
    .filter((c) => c.items.length);
  const all = categories.flatMap((c) => c.items);
  const recentItems = recent.map((href) => all.find((i) => i.href === href)).filter((i): i is SetupItem => !!i);
  return (
    <div className="space-y-4" data-testid="setup-landing">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search setup" className="max-w-80" aria-label="Search setup" />
      {recentItems.length && !needle ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="setup-recent">
          <span className="text-text-muted">Recently visited:</span>
          {recentItems.map((i) => (
            <Link key={i.href} href={i.href} className="crm-pill border-border-strong text-primary hover:underline">
              {i.label}
            </Link>
          ))}
        </div>
      ) : null}
      {visible.length === 0 ? <p className="text-sm text-text-muted">No setup function matches “{q}”.</p> : null}
      <div className="crm-setup-grid">
        {visible.map((c) => (
          <section key={c.key} className="crm-setup-card" data-testid="setup-category" data-category={c.key}>
            <h2 className="crm-setup-card-title">
              <span className="crm-setup-card-icon" aria-hidden="true">
                <Settings2 className="h-4 w-4" />
              </span>
              {c.title}
            </h2>
            <p className="mb-2 mt-1 text-xs text-text-muted">{c.description}</p>
            <ul className="space-y-1 text-sm">
              {c.items.map((i) => (
                <li key={i.key} className="flex items-center gap-1.5">
                  <Link href={i.href} className="text-primary hover:underline" title={i.description} data-setup={i.key}>
                    {i.label}
                  </Link>
                  <StatusTag item={i} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Two-pane settings page: left sub-nav + content. On the Setup home the content is the whole page. */
export function SetupLayout({ categories, children }: { categories: SetupCategory[]; children: ReactNode }) {
  const pathname = usePathname();
  const items = categories.flatMap((c) => c.items);
  // the function this page belongs to: the longest href that is the path or a parent of it
  const current = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    if (!current) return;
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify([current.href, ...readRecent().filter((h) => h !== current.href)].slice(0, 6)));
    } catch {
      /* not remembered */
    }
  }, [current]);

  if (HOME_PATHS.includes(pathname)) return <>{children}</>;
  return (
    <div className="flex items-start gap-4">
      <nav className="crm-subnav hidden max-h-[calc(100vh-8rem)] overflow-y-auto lg:block" aria-label="Setup sections" data-testid="setup-nav">
        <Link href="/setup" className="crm-subnav-item font-bold">
          ← Setup
        </Link>
        {categories.map((c) => (
          <div key={c.key} className="mt-2">
            <div className="crm-menu-title px-2">{c.title}</div>
            {c.items.map((i) => (
              <Link key={i.key} href={i.href} aria-current={current?.key === i.key ? "page" : undefined} className="crm-subnav-item justify-between gap-1">
                <span className="truncate">{i.label}</span>
                {i.status === "PLANNED" ? <span className="text-xs text-text-muted">soon</span> : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
