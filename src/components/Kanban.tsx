import Link from "next/link";
import type { ReactNode } from "react";

export interface KanbanCard {
  id: string;
  title: string;
  subtitle?: string | null;
  href?: string;
  badges?: ReactNode;
  footer?: ReactNode;
}
export interface KanbanColumn {
  key: string;
  label: string;
  cards: KanbanCard[];
}

/** Read-only board. Drag and drop plus stage rules arrive with the Blueprint (prompt 04). */
export function Kanban({ columns }: { columns: KanbanColumn[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <section key={col.key} className="flex w-64 shrink-0 flex-col rounded-lg bg-muted/60 p-2">
          <header className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase text-muted-foreground">
            {col.label}
            <span className="rounded bg-background px-1.5 py-0.5">{col.cards.length}</span>
          </header>
          <div className="flex flex-col gap-2">
            {col.cards.map((card) => {
              const body = (
                <div className="rounded-md border border-border bg-card p-2.5 text-sm shadow-sm hover:border-primary/40">
                  <div className="mb-1 flex flex-wrap gap-1">{card.badges}</div>
                  <div className="font-medium leading-snug">{card.title}</div>
                  {card.subtitle ? <div className="text-xs text-muted-foreground">{card.subtitle}</div> : null}
                  {card.footer ? <div className="mt-1 text-xs">{card.footer}</div> : null}
                </div>
              );
              return card.href ? (
                <Link key={card.id} href={card.href}>
                  {body}
                </Link>
              ) : (
                <div key={card.id}>{body}</div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
