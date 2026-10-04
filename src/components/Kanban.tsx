"use client";

import { ChevronsLeftRight, Minus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar, BrandStripe, StatusPill } from "@/components/crm/primitives";
import { toast } from "@/components/Toaster";
import { Select } from "@/components/ui/select";
import { formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface KanbanCard {
  id: string;
  title: string;
  subtitle?: string | null;
  href?: string;
  badges?: ReactNode;
  footer?: ReactNode;
  amount?: number | null;
  date?: string | null;
  ownerName?: string | null;
  brand?: { code: string; color?: string | null } | null;
  stale?: boolean;
}
export interface KanbanColumn {
  key: string;
  label: string;
  cards: KanbanCard[];
}

/**
 * Kanban board (ModuleKanban): "Stage · count · ₦ total" headers, brand colour stripe on cards, drag between
 * columns (or keyboard: "Move to" on each card), column collapse and a "Kanban by" selector.
 * `onMove` returns false to reject the move (e.g. a Blueprint rule or missing permission).
 */
export function Kanban({
  columns,
  onMove,
  kanbanBy,
}: {
  columns: KanbanColumn[];
  onMove?: (cardId: string, toKey: string) => Promise<boolean>;
  kanbanBy?: { current: string; options: Array<{ value: string; label: string }> };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const move = async (cardId: string, to: string) => {
    if (!onMove) return;
    const ok = await onMove(cardId, to);
    if (ok) router.refresh();
  };

  return (
    <div className="space-y-2">
      {kanbanBy ? (
        <label className="flex items-center gap-2 text-[13px]">
          Kanban by
          <Select
            value={kanbanBy.current}
            onChange={(e) => {
              const p = new URLSearchParams(sp.toString());
              p.set("by", e.target.value);
              router.push(`${pathname}?${p.toString()}`);
            }}
            className="h-8 text-[13px]"
            aria-label="Kanban by"
          >
            {kanbanBy.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Kanban board">
        {columns.map((col) => {
          const total = col.cards.reduce((a, c) => a + (c.amount ?? 0), 0);
          const isCollapsed = collapsed.has(col.key);
          const toggle = () =>
            setCollapsed((s) => {
              const n = new Set(s);
              if (n.has(col.key)) n.delete(col.key);
              else n.add(col.key);
              return n;
            });
          if (isCollapsed) {
            return (
              <button
                key={col.key}
                type="button"
                onClick={toggle}
                data-testid="kanban-column"
                className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg bg-muted py-3 text-xs font-semibold text-text-muted"
                aria-label={`Expand ${col.label}`}
              >
                <ChevronsLeftRight className="h-4 w-4" />
                <span className="[writing-mode:vertical-rl]">
                  {col.label} · {col.cards.length}
                </span>
              </button>
            );
          }
          return (
            <section
              key={col.key}
              role="listitem"
              data-testid="kanban-column"
              aria-label={col.label}
              onDragOver={(e) => {
                if (!onMove) return;
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id && !col.cards.some((c) => c.id === id)) void move(id, col.key);
              }}
              className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-muted p-2", over === col.key && "ring-2 ring-primary")}
            >
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className="text-[13px] font-semibold">{col.label}</span>
                <span className="text-xs text-text-muted">
                  · {col.cards.length}
                  {total ? ` · ${formatMoneyCompact(total)}` : ""}
                </span>
                <button type="button" onClick={toggle} className="ml-auto text-text-muted hover:text-text" aria-label={`Collapse ${col.label}`}>
                  <Minus className="h-4 w-4" />
                </button>
              </header>
              <div className="flex flex-col gap-2">
                {col.cards.map((card) => (
                  <article
                    key={card.id}
                    draggable={!!onMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "relative rounded-md border border-border bg-surface p-2.5 pl-3.5 text-[13px] shadow-sm hover:border-primary/40",
                      dragging === card.id && "opacity-50",
                    )}
                    data-testid="kanban-card"
                  >
                    <BrandStripe brand={card.brand} />
                    {card.badges ? <div className="mb-1 flex flex-wrap gap-1">{card.badges}</div> : null}
                    {card.href ? (
                      <Link href={card.href} className="font-semibold leading-snug text-primary hover:underline">
                        {card.title}
                      </Link>
                    ) : (
                      <div className="font-semibold leading-snug">{card.title}</div>
                    )}
                    {card.subtitle ? <div className="text-xs text-text-muted">{card.subtitle}</div> : null}
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      {card.amount !== undefined && card.amount !== null ? <span className="font-medium">{formatMoneyCompact(card.amount)}</span> : null}
                      {card.date ? <span className="text-text-muted">{card.date}</span> : null}
                      {card.stale ? <StatusPill tone="warning">Stale</StatusPill> : null}
                      {card.ownerName ? <Avatar name={card.ownerName} size={20} className="ml-auto" /> : null}
                    </div>
                    {card.footer ? <div className="mt-1 text-xs">{card.footer}</div> : null}
                    {onMove ? (
                      <label className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:block">
                        Move to
                        <select
                          className="ml-2 rounded border border-border bg-surface text-xs"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) void move(card.id, e.target.value);
                          }}
                        >
                          <option value="">…</option>
                          {columns
                            .filter((c) => c.key !== col.key)
                            .map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))}
                {col.cards.length === 0 ? <p className="px-1 py-4 text-center text-xs text-text-muted">No records</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Helper for callers: shows the error toast and returns false. */
export function rejectMove(message: string): false {
  toast(message, "error");
  return false;
}
