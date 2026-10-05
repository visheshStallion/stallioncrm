"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { setPreferenceAction } from "@/server/modules/preferences/actions";
import type { RailPrefs } from "./ModuleRail";
import type { RailItem } from "./nav-config";
import { DropdownMenu } from "./overlays";

/**
 * Classic navigation mode: the modules as tabs under the header. Tabs that do not fit move into the "⋯" menu;
 * dragging a tab onto another reorders them (saved with the same `rail` preference the sidebar uses).
 */
export function ClassicNav({ items, prefs }: { items: RailItem[]; prefs: RailPrefs }) {
  const pathname = usePathname();
  const router = useRouter();
  const [order, setOrder] = useState(() => {
    const rank = new Map(prefs.order.map((k, i) => [k, i]));
    return [...items].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999)).map((i) => i.key);
  });
  const [fit, setFit] = useState(items.length);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [, start] = useTransition();

  const byKey = new Map(items.map((i) => [i.key, i]));
  const ordered = order.map((k) => byKey.get(k)).filter((x): x is RailItem => !!x);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  // how many tabs fit before the "⋯" button (measured on the hidden full row)
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const widths = Array.from(bar.querySelectorAll<HTMLElement>("[data-measure]")).map((el) => el.offsetWidth);
      const room = bar.clientWidth - 56;
      let used = 0;
      let n = 0;
      for (const w of widths) {
        if (used + w > room) break;
        used += w;
        n++;
      }
      setFit(n === widths.length ? n : Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [order.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = (onto: string) => {
    const from = dragKey.current;
    dragKey.current = null;
    setDropOn(null);
    if (!from || from === onto) return;
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(onto), 0, from);
    setOrder(next);
    start(async () => {
      const res = await setPreferenceAction("rail", { ...prefs, order: next });
      if (!res.ok) toast(res.error.message, "error");
      else router.refresh();
    });
  };

  const shown = ordered.slice(0, fit);
  const overflow = ordered.slice(fit);

  return (
    <div className="relative hidden md:block" data-testid="classic-nav">
      {/* invisible full row, only to measure tab widths */}
      <div ref={barRef} className="crm-navtabs invisible absolute inset-x-0 top-0" aria-hidden="true">
        {ordered.map((i) => (
          <span key={i.key} data-measure className="crm-navtab">
            {i.label}
            {i.badge ? <span className="crm-sidebar-badge static ml-1">{i.badge}</span> : null}
          </span>
        ))}
      </div>
      <nav className="crm-navtabs" aria-label="Modules" data-testid="module-nav">
        {shown.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            aria-current={active(i.href) ? "page" : undefined}
            className="crm-navtab"
            draggable
            data-drop={dropOn === i.key}
            onDragStart={() => (dragKey.current = i.key)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropOn(i.key);
            }}
            onDragLeave={() => setDropOn((k) => (k === i.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              drop(i.key);
            }}
          >
            {i.label}
            {i.badge ? (
              <span className="crm-sidebar-badge static ml-1" data-testid={`rail-badge-${i.key}`}>
                {i.badge > 99 ? "99+" : i.badge}
              </span>
            ) : null}
          </Link>
        ))}
        {overflow.length ? (
          <DropdownMenu
            label="More modules"
            align="left"
            trigger={({ toggle, open, id }) => (
              <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label="More modules" className="crm-navtab h-full">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          >
            {(close) =>
              overflow.map((i) => (
                <Link key={i.key} href={i.href} role="menuitem" onClick={close} className="crm-menu-item" aria-current={active(i.href) ? "page" : undefined}>
                  {i.label}
                </Link>
              ))
            }
          </DropdownMenu>
        ) : null}
      </nav>
    </div>
  );
}
