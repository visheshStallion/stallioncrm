"use client";

import { ChevronsLeft, ChevronsRight, MoreHorizontal, Pin, PinOff, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setPreferenceAction } from "@/server/modules/preferences/actions";
import { Icon } from "./Icon";
import type { RailItem } from "./nav-config";
import { Drawer, DropdownMenu } from "./overlays";

export interface RailPrefs {
  order: string[];
  pinned: string[];
  collapsed: boolean;
}

/**
 * Dark, collapsible left module rail (64 px icons / 220 px icon + label). Items are the modules the
 * profile can read, in the user's saved order; unpinned modules live under "More".
 */
export function ModuleRail({
  items,
  prefs,
  brand,
}: {
  items: RailItem[];
  prefs: RailPrefs;
  /** When a single brand is selected in the switcher, show it at the top. */
  brand?: { id: string; code: string; name: string; color: string | null; hasLogo: boolean } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(prefs.collapsed);
  const [customizing, setCustomizing] = useState(false);
  const [order, setOrder] = useState(() => sortByOrder(items, prefs.order).map((i) => i.key));
  const [pinned, setPinned] = useState(new Set(prefs.pinned));
  const [, start] = useTransition();

  const byKey = new Map(items.map((i) => [i.key, i]));
  const ordered = order.map((k) => byKey.get(k)).filter((x): x is RailItem => !!x);
  const visible = ordered.filter((i) => pinned.has(i.key));
  const more = ordered.filter((i) => !pinned.has(i.key));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const save = (next: Partial<RailPrefs>) =>
    start(async () => {
      const res = await setPreferenceAction("rail", { order, pinned: [...pinned], collapsed, ...next });
      if (!res.ok) toast(res.error.message, "error");
      else router.refresh();
    });

  const link = (i: RailItem) => (
    <Link
      key={i.key}
      href={i.href}
      title={collapsed ? i.label : undefined}
      aria-current={active(i.href) ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-sidebar-fg hover:bg-sidebar-active/70 hover:text-sidebar-active-fg",
        active(i.href) && "bg-sidebar-active font-semibold text-sidebar-active-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon name={i.icon} className="h-[18px] w-[18px] shrink-0" />
      {collapsed ? <span className="sr-only">{i.label}</span> : <span className="truncate">{i.label}</span>}
      {i.badge && !collapsed ? (
        <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white" data-testid={`rail-badge-${i.key}`} title={`${i.badge} ${i.key === "approvals" ? "waiting for your decision" : "overdue"}`}>
          {i.badge > 99 ? "99+" : i.badge}
        </span>
      ) : null}
    </Link>
  );

  return (
    <aside
      className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] md:flex", collapsed ? "w-16" : "w-[220px]")}
      aria-label="Modules"
      data-testid="module-rail"
    >
      <Link href="/" className={cn("flex h-[52px] items-center gap-2 border-b border-white/10 px-4 font-bold text-white", collapsed && "justify-center px-0")}>
        <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs">SC</span>
        {collapsed ? <span className="sr-only">StallionCRM</span> : <span>StallionCRM</span>}
      </Link>
      {brand ? (
        <div className={cn("flex items-center gap-2 border-b border-white/10 px-4 py-2", collapsed && "justify-center px-1")} data-testid="rail-brand">
          {brand.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo from our own API
            <img src={`/api/v1/brands/${brand.id}/logo`} alt={`${brand.code} logo`} className="h-7 max-w-[120px] rounded bg-white object-contain p-0.5" />
          ) : (
            <BrandBadge brand={brand} className="bg-white" />
          )}
        </div>
      ) : null}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" data-testid="module-nav">
        {visible.map(link)}
        {more.length ? (
          <DropdownMenu
            label="More modules"
            align="left"
            className="left-full top-0 ml-2"
            trigger={({ toggle, open, id }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={id}
                className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-sidebar-fg hover:bg-sidebar-active/70", collapsed && "justify-center px-0")}
              >
                <MoreHorizontal className="h-[18px] w-[18px]" />
                {collapsed ? <span className="sr-only">More</span> : "More"}
              </button>
            )}
          >
            {(close) =>
              more.map((i) => (
                <Link key={i.key} href={i.href} role="menuitem" onClick={close} className="flex items-center gap-2 rounded px-2.5 py-1.5 hover:bg-muted">
                  <Icon name={i.icon} className="h-4 w-4" /> {i.label}
                </Link>
              ))
            }
          </DropdownMenu>
        ) : null}
      </nav>
      <div className={cn("flex items-center gap-1 border-t border-white/10 p-2", collapsed && "flex-col")}>
        <button
          type="button"
          onClick={() => setCustomizing(true)}
          className="rounded px-2 py-1 text-xs text-sidebar-fg hover:bg-sidebar-active/70"
          title="Reorder and pin modules"
        >
          {collapsed ? "⋮" : "Customize"}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            save({ collapsed: next });
          }}
          aria-label={collapsed ? "Expand module rail" : "Collapse module rail"}
          className="ml-auto rounded p-1 text-sidebar-fg hover:bg-sidebar-active/70"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      <Drawer open={customizing} onClose={() => setCustomizing(false)} title="Customize modules" width={360}>
        <p className="mb-3 text-sm text-text-muted">Pinned modules show in the rail; the rest are under “More”.</p>
        <ul className="space-y-1" data-testid="rail-customize">
          {ordered.map((i, idx) => (
            <li key={i.key} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
              <Icon name={i.icon} className="h-4 w-4 text-text-muted" />
              <span className="flex-1">{i.label}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move ${i.label} up`}
                disabled={idx === 0}
                onClick={() => setOrder((o) => swap(o, idx, idx - 1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move ${i.label} down`}
                disabled={idx === ordered.length - 1}
                onClick={() => setOrder((o) => swap(o, idx, idx + 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={pinned.has(i.key) ? `Unpin ${i.label}` : `Pin ${i.label}`}
                aria-pressed={pinned.has(i.key)}
                onClick={() =>
                  setPinned((p) => {
                    const n = new Set(p);
                    if (n.has(i.key)) n.delete(i.key);
                    else n.add(i.key);
                    return n;
                  })
                }
              >
                {pinned.has(i.key) ? <Pin className="h-3.5 w-3.5 text-primary" /> : <PinOff className="h-3.5 w-3.5" />}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCustomizing(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              save({ order, pinned: [...pinned] });
              setCustomizing(false);
              toast("Module layout saved", "success");
            }}
          >
            Save
          </Button>
        </div>
      </Drawer>
    </aside>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = [...arr];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function sortByOrder(items: RailItem[], order: string[]): RailItem[] {
  if (!order.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}
