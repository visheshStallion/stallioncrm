import Link from "next/link";
import { formatTime, localDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityRow } from "@/server/modules/activities/queries";
import { TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";

export type CalendarMode = "month" | "week" | "day";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Calendar days are plain YYYY-MM-DD strings (Lagos days); arithmetic happens on UTC midnights. */
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => key(new Date(utc(day).getTime() + n * DAY_MS));
/** Lagos midnight of a calendar day as an instant (UTC+1, no DST). */
export const dayStart = (day: string) => new Date(utc(day).getTime() - 3_600_000);

/** The days shown for a mode around `date`, plus the previous / next anchor days. */
export function calendarRange(mode: CalendarMode, date: string) {
  if (mode === "day") return { days: [date], prev: addDays(date, -1), next: addDays(date, 1), title: label(date) };
  const mondayOffset = (d: string) => (utc(d).getUTCDay() + 6) % 7;
  if (mode === "week") {
    const first = addDays(date, -mondayOffset(date));
    const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
    return { days, prev: addDays(date, -7), next: addDays(date, 7), title: `${label(days[0]!)} – ${label(days[6]!)}` };
  }
  const d = utc(date);
  const monthFirst = key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const first = addDays(monthFirst, -mondayOffset(monthFirst));
  const lastOfMonth = key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  const weeks = Math.ceil((mondayOffset(monthFirst) + utc(lastOfMonth).getUTCDate()) / 7);
  return {
    days: Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i)),
    prev: key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
    next: key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))),
    title: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
  };
}
const label = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]!.slice(0, 3)} ${day.slice(0, 4)}`;

const OWNER_COLORS = ["bg-primary/10 border-primary/40", "bg-success/10 border-success/40", "bg-warning/15 border-warning/50", "bg-info/10 border-info/40", "bg-danger/10 border-danger/40"];

/**
 * Month / week / day calendar (server-rendered, no client JS). Events are the activities the viewer may see –
 * the list arrives already scoped by `listActivities`; team overlays only add owners the viewer manages.
 */
export function Calendar({
  mode,
  date,
  today,
  events,
  owners,
  hrefFor,
  canCreate,
}: {
  mode: CalendarMode;
  date: string;
  today: string;
  events: ActivityRow[];
  /** Owner ids in display order (the viewer first) – drives the colour of an event. */
  owners: string[];
  hrefFor: (p: { mode?: CalendarMode; date?: string }) => string;
  canCreate: boolean;
}) {
  const range = calendarRange(mode, date);
  const byDay = new Map<string, ActivityRow[]>();
  for (const e of events) {
    if (!e.at) continue;
    const k = localDay(e.at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const month = date.slice(0, 7);
  const color = (ownerId: string) => OWNER_COLORS[Math.max(0, owners.indexOf(ownerId)) % OWNER_COLORS.length];
  const nav = "rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted";
  const event = (e: ActivityRow) => (
    <li key={e.id}>
      <Link
        href={`/activities/${e.id}`}
        data-testid="calendar-event"
        title={`${TYPE_LABELS[e.type as ActivityTypeKey]} · ${e.ownerName}`}
        className={cn("block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:underline", color(e.ownerId), e.status !== "OPEN" && "opacity-60 line-through")}
      >
        <span className="font-semibold">{formatTime(e.at)}</span> {e.subject}
        {owners.length > 1 ? <span className="text-text-muted"> · {e.ownerName.split(" ")[0]}</span> : null}
      </Link>
    </li>
  );

  return (
    <div data-testid="calendar">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={hrefFor({ date: range.prev })} className={nav} aria-label="Previous">
          ‹
        </Link>
        <Link href={hrefFor({ date: today })} className={nav}>
          Today
        </Link>
        <Link href={hrefFor({ date: range.next })} className={nav} aria-label="Next">
          ›
        </Link>
        <h2 className="ml-2 text-sm font-semibold" data-testid="calendar-title">
          {range.title}
        </h2>
        <div className="ml-auto flex gap-1" role="tablist" aria-label="Calendar view">
          {(["month", "week", "day"] as const).map((m) => (
            <Link key={m} href={hrefFor({ mode: m })} role="tab" aria-selected={m === mode} className={cn(nav, "capitalize", m === mode && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
              {m}
            </Link>
          ))}
        </div>
      </div>
      <div className={cn("grid overflow-hidden rounded-lg border border-border bg-surface", mode === "day" ? "grid-cols-1" : "grid-cols-7")}>
        {mode !== "day"
          ? WEEKDAYS.map((w) => (
              <div key={w} className="border-b border-border bg-muted px-2 py-1 text-[11px] font-semibold uppercase text-text-muted">
                {w}
              </div>
            ))
          : null}
        {range.days.map((day) => {
          const list = (byDay.get(day) ?? []).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
          const shown = mode === "month" ? list.slice(0, 4) : list;
          return (
            <div
              key={day}
              data-day={day}
              className={cn("border-b border-r border-border p-1.5", mode === "month" ? "min-h-[104px]" : "min-h-[320px]", mode === "month" && day.slice(0, 7) !== month && "bg-muted/40")}
            >
              <div className="mb-1 flex items-center">
                <Link
                  href={hrefFor({ mode: "day", date: day })}
                  className={cn("rounded-full px-1.5 text-xs font-semibold hover:underline", day === today && "bg-primary text-primary-foreground")}
                  aria-label={label(day)}
                >
                  {mode === "day" ? label(day) : Number(day.slice(8))}
                </Link>
                {canCreate ? (
                  <Link href={`/activities/new?type=meeting&date=${day}`} className="ml-auto text-xs text-text-muted hover:text-primary" aria-label={`New activity on ${label(day)}`}>
                    +
                  </Link>
                ) : null}
              </div>
              <ul className="space-y-0.5">{shown.map(event)}</ul>
              {list.length > shown.length ? (
                <Link href={hrefFor({ mode: "day", date: day })} className="text-[11px] text-primary hover:underline">
                  +{list.length - shown.length} more
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
