import type { ReactNode } from "react";
import { brandColor } from "@/components/BrandBadge";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-text-muted border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
  success: "bg-success/10 text-[#14693c] border-success/30 dark:text-success",
  warning: "bg-warning/15 text-[#92600a] border-warning/40 dark:text-warning",
  danger: "bg-danger/10 text-[#b3262b] border-danger/30 dark:text-danger",
  info: "bg-info/10 text-[#0b6e99] border-info/30 dark:text-info",
};

/** Status pill (stage, status, approval state). */
export function StatusPill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span data-testid="status-pill" className={cn("crm-pill", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Avatar with initials (no external images). Colour is derived from the name. */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const bg = brandColor({ code: name });
  return (
    <span
      title={name}
      className={cn("crm-avatar", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), backgroundColor: bg }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  return (
    <span className="inline-flex -space-x-1.5">
      {names.slice(0, max).map((n) => (
        <Avatar key={n} name={n} className="ring-2 ring-surface" />
      ))}
      {names.length > max ? <span className="ml-2 text-xs text-text-muted">+{names.length - max}</span> : null}
    </span>
  );
}

/** Our own empty-state illustration (simple inline SVG – no third-party art). */
export function EmptyState({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center" data-testid="empty-state">
      <svg width="120" height="84" viewBox="0 0 120 84" aria-hidden="true" className="text-primary">
        <rect x="14" y="18" width="92" height="58" rx="6" fill="currentColor" opacity="0.08" />
        <rect x="24" y="30" width="44" height="6" rx="3" fill="currentColor" opacity="0.35" />
        <rect x="24" y="42" width="72" height="5" rx="2.5" fill="currentColor" opacity="0.18" />
        <rect x="24" y="52" width="60" height="5" rx="2.5" fill="currentColor" opacity="0.18" />
        <circle cx="94" cy="20" r="12" fill="currentColor" opacity="0.9" />
        <path d="M89 20h10M94 15v10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <p className="crm-empty-title">{title}</p>
        {text ? <p className="mt-1 text-sm text-text-muted">{text}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

/** Brand colour stripe (left edge of kanban cards / record headers). */
export function BrandStripe({ brand, className }: { brand?: { code: string; color?: string | null } | null; className?: string }) {
  return <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px] rounded-l-[inherit]", className)} style={{ backgroundColor: brand ? brandColor(brand) : "transparent" }} />;
}

/** Page title row inside the content (breadcrumb-less, like the reference CRM). */
export function PageTitleRow({ title, left, actions }: { title: ReactNode; left?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="crm-page-title">
      <h1>{title}</h1>
      {left}
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/** Small banner for pending approvals on a record (prompt 08 fills it). */
export function ApprovalBanner({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="approval-banner">
      {children}
    </div>
  );
}
