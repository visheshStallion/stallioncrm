import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { CreateSplitButton, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { EmptyState, StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatDateTime, localDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { parsePaging } from "@/server/list/filters";
import { listActivities, teamMembers } from "@/server/modules/activities/queries";
import { ACTIVITY_TYPES, STATUS_LABELS, TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { Calendar, calendarRange, dayStart, type CalendarMode } from "./Calendar";

export const metadata = { title: "Activities" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : []);

const VIEWS = [
  { id: "my", name: "My Open Activities" },
  { id: "overdue", name: "My Overdue Activities" },
  { id: "today", name: "My Activities Today" },
  { id: "open", name: "All Open Activities" },
  { id: "all", name: "All Activities" },
];

/** "My Activities" list and the calendar (prompt 07 §2). Everything is scoped by the access context. */
export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "activities", "read")) forbidden();
  const [dir, ui, prefs, team] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx), teamMembers(ctx)]);
  const canCreate = hasPermission(ctx, "activities", "create");
  const type = ACTIVITY_TYPES.includes(one(sp.type) as ActivityTypeKey) ? one(sp.type) : undefined;
  const isCalendar = one(sp.view) === "calendar";
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  const today = localDay(new Date());

  const actions = (
    <>
      <Button asChild variant="outline">
        <Link href={isCalendar ? "/activities" : "/activities?view=calendar"} data-testid="calendar-toggle">
          {isCalendar ? "List" : "Calendar"}
        </Link>
      </Button>
      {canCreate ? <CreateSplitButton label="Create Task" href="/activities/new?type=task" /> : null}
    </>
  );

  if (isCalendar) {
    const mode: CalendarMode = one(sp.mode) === "week" || one(sp.mode) === "day" ? (one(sp.mode) as CalendarMode) : "month";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date) ?? "") ? one(sp.date)! : today;
    // Team overlay: only users the viewer manages (or everyone for management) can be added.
    const allowed = new Set(team.map((u) => u.id));
    const overlay = many(sp.users).filter((u) => allowed.has(u) && u !== ctx.userId);
    const owners = [ctx.userId, ...overlay];
    const range = calendarRange(mode, date);
    const { rows } = await listActivities(
      ctx,
      { view: "all", type, ownerIds: owners, from: dayStart(range.days[0]!), to: new Date(dayStart(range.days[range.days.length - 1]!).getTime() + 86_400_000) },
      ui,
      { take: 1000 },
    );
    const hrefFor = (p: { mode?: CalendarMode; date?: string }) => {
      const q = new URLSearchParams({ view: "calendar", mode: p.mode ?? mode, date: p.date ?? date });
      if (overlay.length) q.set("users", overlay.join(","));
      if (type) q.set("type", type);
      return `/activities?${q}`;
    };
    return (
      <ModuleListFrame title={<h1 className="text-lg font-semibold">Calendar</h1>} actions={actions}>
        {team.length ? (
          <form method="get" action="/activities" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 text-xs" data-testid="team-overlay">
            <input type="hidden" name="view" value="calendar" />
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="date" value={date} />
            <span className="font-semibold">Team calendars:</span>
            {team
              .filter((u) => u.id !== ctx.userId)
              .slice(0, 40)
              .map((u) => (
                <label key={u.id} className="flex items-center gap-1">
                  <input type="checkbox" name="users" value={u.id} defaultChecked={overlay.includes(u.id)} /> {u.name}
                </label>
              ))}
            <Button type="submit" size="sm" variant="outline">
              Show
            </Button>
          </form>
        ) : null}
        <Calendar mode={mode} date={date} today={today} events={rows} owners={owners} hrefFor={hrefFor} canCreate={canCreate} />
      </ModuleListFrame>
    );
  }

  const viewId = VIEWS.some((v) => v.id === one(sp.view)) ? one(sp.view)! : "my";
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) ?? "20" });
  const { rows, total } = await listActivities(ctx, { view: viewId, type, q: one(sp.q) }, ui, { take: paging.per, skip: paging.skip, order: viewId === "all" ? "desc" : "asc" });
  const typeHref = (t: string) => {
    const q = new URLSearchParams({ view: viewId });
    if (t) q.set("type", t);
    return `/activities?${q}`;
  };

  return (
    <ModuleListFrame title={<ViewSelector current={viewId} views={VIEWS.map((v) => ({ ...v, group: "system" as const }))} />} actions={actions}>
      <form method="get" action="/activities" className="mb-3 flex items-center gap-2">
        <input type="hidden" name="view" value={viewId} />
        <Select name="type" defaultValue={type ?? ""} aria-label="Activity type" className="w-44">
          <option value="">All types</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {type ? (
          <Link href={typeHref("")} className="text-xs text-primary hover:underline">
            Clear
          </Link>
        ) : null}
      </form>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No activities in this view" text="Tasks, calls, meetings and test drives you plan on leads and deals show up here." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="activities-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Related to</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <Link href={`/activities/${a.id}`} className="font-medium text-primary hover:underline">
                      {a.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{TYPE_LABELS[a.type as ActivityTypeKey]}</td>
                  <td className={cn("px-3 py-2", a.overdue && "font-semibold text-danger")}>{a.at ? formatDateTime(a.at, prefs.dateFormat) : "—"}</td>
                  <td className="px-3 py-2">
                    {a.overdue ? <StatusPill tone="danger">Overdue</StatusPill> : <StatusPill tone={a.status === "COMPLETED" ? "success" : a.status === "OPEN" ? "primary" : "neutral"}>{STATUS_LABELS[a.status as keyof typeof STATUS_LABELS]}</StatusPill>}
                  </td>
                  <td className="px-3 py-2">
                    {a.parentHref ? (
                      <Link href={a.parentHref} className="text-primary hover:underline">
                        {a.parentType}
                      </Link>
                    ) : (
                      a.parentType
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <BrandBadge brand={brand(a.brandId)} />
                  </td>
                  <td className="px-3 py-2">{a.ownerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </ModuleListFrame>
  );
}
