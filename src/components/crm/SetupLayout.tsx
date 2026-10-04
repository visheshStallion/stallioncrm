"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SetupCategory {
  key: string;
  title: string;
  description: string;
  items: Array<{ href: string; label: string; available: boolean }>;
}

/** Setup landing: searchable grid of categories. */
export function SetupLanding({ categories }: { categories: SetupCategory[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const visible = categories
    .map((c) => ({ ...c, items: c.items.filter((i) => !needle || i.label.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle)) }))
    .filter((c) => c.items.length);
  return (
    <div className="space-y-4" data-testid="setup-landing">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search setup" className="max-w-sm" aria-label="Search setup" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((c) => (
          <section key={c.key} className="rounded-lg border border-border bg-surface p-4" data-testid="setup-category">
            <h2 className="font-semibold">{c.title}</h2>
            <p className="mb-2 text-xs text-text-muted">{c.description}</p>
            <ul className="space-y-1 text-[13px]">
              {c.items.map((i) => (
                <li key={i.href}>
                  {i.available ? (
                    <Link href={i.href} className="text-primary hover:underline">
                      {i.label}
                    </Link>
                  ) : (
                    <span className="text-text-muted" title="Arrives with a later module">
                      {i.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Two-pane settings page: left sub-nav + content. */
export function SetupLayout({ categories, children }: { categories: SetupCategory[]; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin") return <>{children}</>;
  return (
    <div className="flex items-start gap-4">
      <nav className="sticky top-[68px] w-56 shrink-0 rounded-lg border border-border bg-surface p-2 text-[13px]" aria-label="Setup sections" data-testid="setup-nav">
        <Link href="/admin" className="mb-1 block rounded px-2 py-1 font-semibold hover:bg-muted">
          ← Setup
        </Link>
        {categories.map((c) => {
          const items = c.items.filter((i) => i.available);
          if (!items.length) return null;
          return (
            <div key={c.key} className="mt-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase text-text-muted">{c.title}</div>
              {items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={pathname === i.href ? "page" : undefined}
                  className={cn("block rounded px-2 py-1 hover:bg-muted", pathname === i.href && "bg-primary/10 font-semibold text-primary")}
                >
                  {i.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
