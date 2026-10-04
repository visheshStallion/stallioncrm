import Link from "next/link";
import type { ReactNode } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { RegionBadge } from "@/components/RegionBadge";
import { formatDate, formatDateTime, formatMoney, formatMoneyCompact, formatTime } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { listActivities } from "@/server/modules/activities/queries";
import { TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { OPEN_DEALS } from "@/server/modules/deals/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Home" };

function Widget({ title, href, children, testId }: { title: string; href?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface" data-testid={testId ?? "home-widget"}>
      <header className="flex items-center border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {href ? (
          <Link href={href} className="ml-auto text-xs text-primary hover:underline">
            View all
          </Link>
        ) : null}
      </header>
      <div className="flex-1 p-4 text-[13px]">{children}</div>
    </section>
  );
}

function Bars({ rows }: { rows: Array<{ label: ReactNode; value: number; display: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-text-muted">No open deals.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[120px_1fr_80px] items-center gap-2">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded-full bg-muted">
            <span className="block h-2.5 rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right text-xs text-text-muted">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Home (prompt 17 §3e): widgets grid with a per-role default layout. */
export default async function HomePage() {
  const ctx = await requireContext();
  const [dir, prefs] = await Promise.all([getDirectory(ctx), getPreferences(ctx)]);
  const db = scopedDb(ctx);
  const canDeals = hasPermission(ctx, "deals", "read");
  const canLeads = hasPermission(ctx, "leads", "read");
  const manager = ctx.scope === "ALL" || ctx.memberships.some((m) => m.isManager);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const open = OPEN_DEALS;
  const mine = manager ? {} : { ownerId: ctx.userId };

  const [byStage, byBrand, closing, myLeads] = await Promise.all([
    canDeals ? db.deal.groupBy({ by: ["stageId"], where: { ...open, ...mine }, _count: { _all: true }, _sum: { amount: true } }) : [],
    canDeals && manager ? db.deal.groupBy({ by: ["brandId"], where: open, _count: { _all: true }, _sum: { amount: true } }) : [],
    canDeals
      ? db.deal.findMany({
          where: { ...open, ...mine, closeDate: { gte: monthStart, lt: monthEnd } },
          select: { id: true, name: true, amount: true, closeDate: true, brandId: true },
          orderBy: { closeDate: "asc" },
          take: 8,
        })
      : [],
    canLeads
      ? db.lead.findMany({
          where: { ownerId: ctx.userId, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
          select: { id: true, firstName: true, lastName: true, rating: true, brandId: true, regionId: true },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : [],
  ]);
  const canActivities = hasPermission(ctx, "activities", "read");
  const [myTasks, todays] = canActivities
    ? await Promise.all([listActivities(ctx, { view: "my", type: "TASK" }, {}, { take: 8 }), listActivities(ctx, { view: "today" }, {}, { take: 8 })])
    : [{ rows: [] }, { rows: [] }];
  const meetings = todays.rows.filter((a) => a.type !== "TASK");
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  // Pipelines are per brand: group the stage totals by stage key so brands line up.
  const stageInfo = byStage.length
    ? await db.pipelineStage.findMany({ where: { id: { in: byStage.map((s) => s.stageId!).filter(Boolean) } }, select: { id: true, key: true, name: true, order: true } })
    : [];
  const stageTotals = new Map<string, { name: string; order: number; count: number; amount: number }>();
  for (const s of byStage) {
    const info = stageInfo.find((x) => x.id === s.stageId);
    if (!info) continue;
    const cur = stageTotals.get(info.key) ?? { name: info.name, order: info.order, count: 0, amount: 0 };
    cur.count += s._count._all;
    cur.amount += Number(s._sum.amount ?? 0);
    stageTotals.set(info.key, cur);
  }

  return (
    <div>
      <PageTitleRow
        title={`Welcome, ${ctx.user.name.split(" ")[0]}`}
        left={<span className="text-[13px] text-text-muted">{ctx.user.roleName} · {ctx.scope === "ALL" ? "all brands & regions" : `${ctx.memberships.length} territor${ctx.memberships.length === 1 ? "y" : "ies"}`}</span>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="home-widgets">
        {canActivities ? (
          <Widget title="My open tasks" href="/activities" testId="widget-tasks">
            {myTasks.rows.length ? (
              <ul className="divide-y divide-border">
                {myTasks.rows.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-1.5">
                    <BrandBadge brand={brand(a.brandId)} />
                    <Link href={`/activities/${a.id}`} className="flex-1 truncate text-primary hover:underline">
                      {a.subject}
                    </Link>
                    {a.overdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
                    <span className="text-xs text-text-muted">{a.at ? formatDateTime(a.at, prefs.dateFormat) : "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No open tasks" />
            )}
          </Widget>
        ) : null}
        {canActivities ? (
          <Widget title="Today's meetings, calls & test drives" href="/activities?view=calendar&mode=day" testId="widget-today">
            {meetings.length ? (
              <ul className="divide-y divide-border">
                {meetings.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-12 text-xs font-semibold">{formatTime(a.at)}</span>
                    <BrandBadge brand={brand(a.brandId)} />
                    <Link href={`/activities/${a.id}`} className="flex-1 truncate text-primary hover:underline">
                      {a.subject}
                    </Link>
                    <span className="text-xs text-text-muted">{TYPE_LABELS[a.type as ActivityTypeKey]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing scheduled today" />
            )}
          </Widget>
        ) : null}
        {canDeals ? (
          <Widget title={manager ? "Pipeline by stage" : "My pipeline by stage"} href="/deals?layout=kanban">
            <Bars
              rows={[...stageTotals.values()]
                .sort((a, b) => a.order - b.order)
                .map((s) => ({ label: s.name, value: s.amount, display: `${s.count} · ${formatMoneyCompact(s.amount)}` }))}
            />
          </Widget>
        ) : null}
        {manager && canDeals ? (
          <Widget title="Open pipeline by brand" testId="pipeline-by-brand">
            <Bars rows={byBrand.map((b) => ({ label: <BrandBadge brand={brand(b.brandId)} />, value: Number(b._sum.amount ?? 0), display: formatMoneyCompact(Number(b._sum.amount ?? 0)) }))} />
          </Widget>
        ) : null}
        {canDeals ? (
          <Widget title="Deals closing this month" href="/deals">
            {closing.length ? (
              <ul className="divide-y divide-border">
                {closing.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1.5">
                    <BrandBadge brand={brand(d.brandId)} />
                    <Link href={`/deals/${d.id}`} className="flex-1 truncate text-primary hover:underline">
                      {d.name}
                    </Link>
                    <span className="text-xs text-text-muted">{formatDate(d.closeDate, prefs.dateFormat)}</span>
                    <span className="w-28 text-right text-xs">{formatMoney(d.amount === null ? null : Number(d.amount))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-muted">No deals closing this month.</p>
            )}
          </Widget>
        ) : null}
        {canLeads ? (
          <Widget title="My open leads" href="/leads?view=mine">
            {myLeads.length ? (
              <ul className="divide-y divide-border">
                {myLeads.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-1.5">
                    <BrandBadge brand={brand(l.brandId)} />
                    <Link href={`/leads/${l.id}`} className="flex-1 truncate text-primary hover:underline">
                      {[l.firstName, l.lastName].filter(Boolean).join(" ")}
                    </Link>
                    <RegionBadge region={dir.regions.find((r) => r.id === l.regionId)} />
                    {l.rating ? <StatusPill tone={l.rating === "HOT" ? "danger" : l.rating === "WARM" ? "warning" : "info"}>{l.rating}</StatusPill> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-muted">No open leads assigned to you.</p>
            )}
          </Widget>
        ) : null}
        <Widget title="Approvals pending">
          <EmptyState title="No approvals waiting" text="Discount and brand-change approvals arrive with the Approvals module." />
        </Widget>
      </div>
    </div>
  );
}
