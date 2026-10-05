import { ArrowLeft, Check, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { PrintButton, SaveAsTemplateButton, SendEmailButton } from "./PrintActions";
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
    <div className="crm-record-bar" data-testid="record-header">
      <BrandStripe brand={brand} />
      <Link href={backHref} className="crm-icon-btn" aria-label="Back">
        <ArrowLeft />
      </Link>
      <Avatar name={title} size={36} />
      <div className="min-w-0">
        <div className="text-xs text-text-muted">{moduleLabel}</div>
        <h1 className="crm-record-title">
          <span className="sr-only">{moduleLabel}: </span>
          {title}
        </h1>
      </div>
      {brand ? <BrandBadge brand={brand} size="lg" /> : null}
      {owner ? (
        <span className="crm-owner-chip" title="Owner">
          <Avatar name={owner} size={20} />
          {owner}
        </span>
      ) : null}
      {meta}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SendEmailButton />
        <PrintButton />
        {actions}
        <SaveAsTemplateButton />
        {nav}
      </div>
    </div>
  );
}

/** Stage progress bar (Enquiry ▸ Test Drive ▸ … ). */
export function StageProgressBar({ stages, current, lost }: { stages: Array<{ key: string; label: string }>; current: string; lost?: boolean }) {
  const idx = stages.findIndex((s) => s.key === current);
  return (
    <ol className="crm-stagebar" aria-label="Stage progress" data-testid="stage-progress">
      {stages.map((s, i) => {
        const done = i < idx;
        const isCurrent = i === idx;
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className="crm-stage"
            data-state={isCurrent ? (lost ? "lost" : "current") : done ? "done" : "upcoming"}
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
    <nav className="crm-tabs" aria-label="Record tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className="crm-tab"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Left, sticky related-list navigation; a row of tabs above the content below 1024px. */
export function RelatedNav({ items }: { items: Array<{ id: string; label: string; count?: number }> }) {
  return (
    <nav className="crm-related-nav" aria-label="Related lists">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="crm-related-item">
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
    <details id={id} open={defaultOpen} className="crm-section" data-testid="field-section">
      <summary className="crm-section-title marker:text-text-subtle">{title}</summary>
      <dl className="crm-field-grid">{children}</dl>
    </details>
  );
}

/** Read-only field row; masked fields show a lock and the masked value; hidden fields are not rendered. */
export function Field({ label, value, masked, hidden }: { label: string; value: ReactNode; masked?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="crm-field">
      <dt className="crm-field-label">{label}</dt>
      <dd className="crm-field-value" data-field={label}>
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
    <section id={id} className="crm-related-card" data-testid="related-list">
      <header className="crm-card-header">
        <h2>{title}</h2>
        {count !== undefined ? <span className="crm-kanban-count bg-surface-alt">{count}</span> : null}
        {newHref ? (
          <Link href={newHref} className="ml-auto text-sm font-bold text-primary hover:underline">
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
    <section className="crm-section">
      <h2 className="crm-section-title">{title}</h2>
      <div className="crm-form-grid">{children}</div>
    </section>
  );
}

/** Sticky form bar: [Cancel] [Save and New] [Save], right-aligned. */
export function StickyFormFooter({ cancelHref, saveAndNew, children }: { cancelHref: string; saveAndNew?: ReactNode; children: ReactNode }) {
  return (
    <div className="crm-form-bar" data-testid="form-footer">
      <Link href={cancelHref} className="crm-btn crm-btn-secondary">
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
    <span className="crm-required" aria-label="required">
      *
    </span>
  );
}
