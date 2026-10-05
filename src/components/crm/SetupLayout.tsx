"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Settings2 } from "lucide-react";

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
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search setup" className="max-w-80" aria-label="Search setup" />
      <div className="crm-setup-grid">
        {visible.map((c) => (
          <section key={c.key} className="crm-setup-card" data-testid="setup-category">
            <h2 className="crm-setup-card-title">
              <span className="crm-setup-card-icon" aria-hidden="true">
                <Settings2 className="h-4 w-4" />
              </span>
              {c.title}
            </h2>
            <p className="mb-2 mt-1 text-xs text-text-muted">{c.description}</p>
            <ul className="space-y-1 text-sm">
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
      <nav className="crm-subnav hidden lg:block" aria-label="Setup sections" data-testid="setup-nav">
        <Link href="/admin" className="crm-subnav-item font-bold">
          ← Setup
        </Link>
        {categories.map((c) => {
          const items = c.items.filter((i) => i.available);
          if (!items.length) return null;
          return (
            <div key={c.key} className="mt-2">
              <div className="crm-menu-title px-2">{c.title}</div>
              {items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={pathname === i.href ? "page" : undefined}
                  className="crm-subnav-item"
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
