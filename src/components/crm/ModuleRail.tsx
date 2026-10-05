"use client";

import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight, CircleHelp, MoreHorizontal, Pin, PinOff, Settings, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BrandLogo } from "@/components/BrandLogo";
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

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl K", "Search"],
  ["c", "Create a record"],
  ["e", "Edit the record"],
  ["/", "Filter the list"],
  ["j / k", "Next / previous record"],
];

/**
 * Dark left module rail (sidebar navigation mode): icons with a small label below, or icon + label in a row when
 * pinned open. Items are the modules the profile can read, in the user's saved order; unpinned modules live under
 * "More". Sizes come from the --w-sidebar* / --h-sidebar-item tokens.
 */
export function ModuleRail({
  items,
  prefs,
  brand,
  isAdmin = false,
}: {
  items: RailItem[];
  prefs: RailPrefs;
  /** Setup is offered at the bottom of the rail to administrators. */
  isAdmin?: boolean;
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
    <Link key={i.key} href={i.href} title={collapsed ? i.label : undefined} aria-current={active(i.href) ? "page" : undefined} className="crm-sidebar-item">
      <Icon name={i.icon} />
      <span className="crm-sidebar-label">{i.label}</span>
      {i.badge ? (
        <span className="crm-sidebar-badge" data-testid={`rail-badge-${i.key}`} title={`${i.badge} ${i.key === "approvals" ? "waiting for your decision" : "overdue"}`}>
          {i.badge > 99 ? "99+" : i.badge}
        </span>
      ) : null}
    </Link>
  );

  return (
    <aside className="crm-sidebar hidden md:flex" data-open={!collapsed} aria-label="Modules" data-testid="module-rail">
      <Link href="/" className="crm-sidebar-top">
        <span className="crm-logo-mark">SC</span>
        {collapsed ? <span className="sr-only">StallionCRM</span> : <span>StallionCRM</span>}
      </Link>
      {brand ? (
        <div className="crm-sidebar-brand" data-testid="rail-brand">
          <BrandLogo brand={brand} showName={false} className="rounded-md bg-white p-0.5" />
          <span className={cn("font-bold text-white", collapsed ? "text-[10px]" : "text-xs")}>{brand.code}</span>
        </div>
      ) : null}
      <nav className="crm-sidebar-nav" data-testid="module-nav">
        {visible.map(link)}
        {more.length ? (
          <DropdownMenu
            label="More modules"
            align="left"
            className="left-full top-0 ml-1 mt-0"
            trigger={({ toggle, open, id }) => (
              <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="crm-sidebar-item crm-sidebar-group">
                <MoreHorizontal />
                <span className="crm-sidebar-label">More</span>
              </button>
            )}
          >
            {(close) =>
              more.map((i) => (
                <Link key={i.key} href={i.href} role="menuitem" onClick={close} className="crm-menu-item">
                  <Icon name={i.icon} className="h-4 w-4" /> {i.label}
                </Link>
              ))
            }
          </DropdownMenu>
        ) : null}
      </nav>
      <div className="crm-sidebar-group">
        {isAdmin ? (
          <Link href="/admin" className="crm-sidebar-item" title="Setup" aria-current={pathname.startsWith("/admin") ? "page" : undefined}>
            <Settings />
            <span className="crm-sidebar-label">Setup</span>
          </Link>
        ) : null}
        <DropdownMenu
          label="Help"
          align="left"
          className="bottom-0 left-full ml-1 mt-0 w-64"
          trigger={({ toggle, open, id }) => (
            <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="crm-sidebar-item" title="Help and keyboard shortcuts">
              <CircleHelp />
              <span className="crm-sidebar-label">Help</span>
            </button>
          )}
        >
          <div className="crm-menu-title">Keyboard shortcuts</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-2 text-xs">
            {SHORTCUTS.map(([k, what]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="crm-kbd">{k}</kbd>
                </dt>
                <dd className="text-text-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </DropdownMenu>
        <button type="button" onClick={() => setCustomizing(true)} className="crm-sidebar-item" title="Reorder and pin modules">
          <SlidersHorizontal />
          <span className="crm-sidebar-label">Customize</span>
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            save({ collapsed: next });
          }}
          aria-label={collapsed ? "Expand module rail" : "Collapse module rail"}
          aria-pressed={!collapsed}
          className="crm-sidebar-item"
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          <span className="crm-sidebar-label">{collapsed ? "Pin open" : "Collapse"}</span>
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
