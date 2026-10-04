"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/crm/Icon";
import type { RailItem } from "@/components/crm/nav-config";
import { cn } from "@/lib/utils";

const PRIMARY = ["home", "leads", "deals", "activities"];

/**
 * Bottom navigation for phones (prompt 14): Home, Leads, Deals, Activities, More. Only modules the profile can
 * read are passed in; "More" opens a sheet with the rest plus the field tools. Tap targets are at least 48 px.
 */
export function MobileNav({ items, unread }: { items: RailItem[]; unread: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const primary = PRIMARY.map((k) => items.find((i) => i.key === k)).filter((x): x is RailItem => !!x);
  const rest = items.filter((i) => !PRIMARY.includes(i.key));
  const tools = [
    { key: "quick", label: "Quick actions", href: "/quick", icon: "zap" },
    { key: "search", label: "Search", href: "/search", icon: "search" },
    { key: "notifications", label: unread ? `Notifications (${unread})` : "Notifications", href: "/notifications", icon: "bell" },
    ...(items.some((i) => i.key === "inventory") ? [{ key: "scan", label: "Scan VIN", href: "/inventory/scan", icon: "scan-line" }] : []),
  ];
  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]";
  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-14 max-h-[70vh] overflow-y-auto rounded-t-xl border-t border-border bg-surface p-3" data-testid="mobile-more">
            <ul className="grid grid-cols-3 gap-2">
              {[...tools, ...rest].map((i) => (
                <li key={i.key}>
                  <Link href={i.href} onClick={() => setOpen(false)} className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-border px-2 py-2 text-center text-xs", active(i.href) && "border-primary text-primary")}>
                    <Icon name={i.icon} className="h-5 w-5" />
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden" aria-label="Main" data-testid="mobile-nav">
        {primary.map((i) => (
          <Link key={i.key} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={cn(tab, active(i.href) ? "font-semibold text-primary" : "text-text")}>
            <Icon name={i.icon} className="h-5 w-5" />
            {i.label}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn(tab, open ? "font-semibold text-primary" : "text-text")}>
          <Icon name="more-horizontal" className="h-5 w-5" />
          More
        </button>
      </nav>
    </>
  );
}
