import { ArrowLeft, Check, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { cn } from "@/lib/utils";
import { Avatar, BrandStripe } from "./primitives";

/** Record header: ← Back · brand chip · "Module: name" · owner · actions. */
export function RecordHeader({
  backHref,
  brand,
  moduleLabel,
  title,
  owner,
  meta,
  actions,
  nav,
}: {
  backHref: string;
  brand?: { code: string; name?: string; color?: string | null } | null;
  moduleLabel: string;
  title: string;
  owner?: string | null;
  meta?: ReactNode;
  actions?: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div className="relative mb-3 rounded-lg border border-border bg-surface px-4 py-3 pl-5" data-testid="record-header">
      <BrandStripe brand={brand} />
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {brand ? <BrandBadge brand={brand} size="lg" /> : null}
        <h1 className="text-[20px] font-semibold leading-tight">
          <span className="font-normal text-text-muted">{moduleLabel}: </span>
          {title}
        </h1>
        {meta}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {owner ? (
            <span className="flex items-center gap-1.5 text-[13px]" title="Owner">
              <Avatar name={owner} size={24} />
              {owner}
            </span>
          ) : null}
          {nav}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** Stage progress bar (Enquiry ▸ Test Drive ▸ … ). */
export function StageProgressBar({ stages, current, lost }: { stages: Array<{ key: string; label: string }>; current: string; lost?: boolean }) {
  const idx = stages.findIndex((s) => s.key === current);
  return (
    <ol className="mb-3 flex overflow-x-auto rounded-lg border border-border bg-surface" aria-label="Stage progress" data-testid="stage-progress">
      {stages.map((s, i) => {
        const done = i < idx;
        const isCurrent = i === idx;
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex min-w-28 flex-1 items-center justify-center gap-1 border-r border-border px-3 py-2 text-xs font-medium last:border-r-0",
              done && "bg-primary/10 text-primary",
              isCurrent && (lost ? "bg-danger text-white" : "bg-primary text-primary-foreground"),
              !done && !isCurrent && "text-text-muted",
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : null}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/** Overview | Timeline tabs (link based – works without JS). */
export function DetailTabs({ tabs, current }: { tabs: Array<{ key: string; label: string; href: string }>; current: string }) {
  return (
    <nav className="mb-3 flex gap-1 border-b border-border" aria-label="Record tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", t.key === current ? "border-primary font-semibold text-primary" : "border-transparent text-text-muted hover:text-text")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Left, sticky related-list navigation. */
export function RelatedNav({ items }: { items: Array<{ id: string; label: string; count?: number }> }) {
  return (
    <nav className="sticky top-[68px] hidden w-48 shrink-0 self-start rounded-lg border border-border bg-surface p-2 lg:block" aria-label="Related lists">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="flex items-center justify-between rounded px-2 py-1.5 text-[13px] hover:bg-muted">
          {i.label}
          {i.count !== undefined ? <span className="text-xs text-text-muted">{i.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}

/** Collapsible section with a 2-column field grid. */
export function FieldSection({ title, children, defaultOpen = true, id }: { title: string; children: ReactNode; defaultOpen?: boolean; id?: string }) {
  return (
    <details id={id} open={defaultOpen} className="group rounded-lg border border-border bg-surface" data-testid="field-section">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] font-semibold marker:text-text-muted">{title}</summary>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 px-4 pb-4 sm:grid-cols-2">{children}</dl>
    </details>
  );
}

/** Read-only field row; masked fields show a lock and the masked value; hidden fields are not rendered. */
export function Field({ label, value, masked, hidden }: { label: string; value: ReactNode; masked?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-2 border-b border-border/60 py-1.5 text-[13px]">
      <dt className="text-text-muted">{label}</dt>
      <dd data-field={label}>
        {masked ? (
          <span className="inline-flex items-center gap-1" title="Masked by field-level security">
            <Lock className="h-3 w-3 text-text-muted" aria-label="masked" />
            {value}
          </span>
        ) : value === null || value === undefined || value === "" ? (
          <span className="text-text-muted">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export const MaskedField = (p: { label: string; value: ReactNode }) => <Field {...p} masked />;

/** Related list as a card with "+ New" and a "⋯" slot. */
export function RelatedListCard({ id, title, count, newHref, children, empty = "No records" }: { id: string; title: string; count?: number; newHref?: string; children?: ReactNode; empty?: string }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border border-border bg-surface" data-testid="related-list">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {count !== undefined ? <span className="text-xs text-text-muted">{count}</span> : null}
        {newHref ? (
          <Link href={newHref} className="ml-auto text-xs font-semibold text-primary hover:underline">
            + New
          </Link>
        ) : null}
      </header>
      <div className="p-4 text-[13px]">{children ?? <p className="text-text-muted">{empty}</p>}</div>
    </section>
  );
}

export interface TimelineEntry {
  id: string;
  at: string;
  who: string;
  title: string;
  kind: "field" | "activity" | "email" | "approval" | "system";
  details?: Array<{ field: string; from: unknown; to: unknown }>;
}

/** Chronological feed (field changes, activities, emails, approvals). */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-[13px] text-text-muted">No history yet.</p>;
  return (
    <ol className="space-y-3" data-testid="timeline">
      {entries.map((e) => (
        <ActivityItem key={e.id} entry={e} />
      ))}
    </ol>
  );
}

export function ActivityItem({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="relative border-l-2 border-border pl-4">
      <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
      <div className="text-xs text-text-muted">
        {entry.at} · {entry.who}
      </div>
      <div className="text-[13px] font-medium">{entry.title}</div>
      {entry.details?.map((d) => (
        <div key={d.field} className="text-xs">
          {d.field}: <span className="text-text-muted line-through">{String(d.from ?? "—")}</span> → {String(d.to ?? "—")}
        </div>
      ))}
    </li>
  );
}

/** Form section (2-column grid) for RecordFormPage. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Sticky form footer: [Cancel] [Save and New] [Save]. */
export function StickyFormFooter({ cancelHref, saveAndNew, children }: { cancelHref: string; saveAndNew?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 flex justify-end gap-2 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur" data-testid="form-footer">
      <Link href={cancelHref} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">
        Cancel
      </Link>
      {saveAndNew}
      {children}
    </div>
  );
}

/** Mandatory field label marker. */
export function Required() {
  return (
    <span className="ml-0.5 text-danger" aria-label="required">
      *
    </span>
  );
}
