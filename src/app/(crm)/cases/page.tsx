import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { CreateSplitButton, ModuleListFrame, Pagination } from "@/components/crm/ListPage";
import { EmptyState, StatusPill } from "@/components/crm/primitives";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { parsePaging } from "@/server/list/filters";
import { listCases, queueCounts, QUEUES } from "@/server/modules/cases/queries";
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/server/modules/cases/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { SLA_LABEL, SLA_TONE, STATUS_TONE } from "./tones";

export const metadata = { title: "Cases" };
type SP = { queue?: string; q?: string; page?: string; per?: string };

/** Case queues: My cases, Unassigned – my brand, Breaching SLA, all open, all. Scoped to the viewer's brands. */
export default async function CasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "cases", "read")) forbidden();
  const queue = QUEUES.some((q) => q.id === sp.queue) ? sp.queue! : "my";
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "25" });
  const [ui, dir, prefs] = await Promise.all([getUiFilters(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const [{ rows, total }, counts] = await Promise.all([listCases(ctx, { queue, q: sp.q }, ui, { take: paging.per, skip: paging.skip }), queueCounts(ctx, ui)]);
  const tab = "rounded-md border px-3 py-1 text-xs font-semibold";

  return (
    <ModuleListFrame
      title={<h1 className="text-lg font-semibold">Cases</h1>}
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/cases/solutions">Solutions</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/cases/sla">SLA &amp; calendar</Link>
          </Button>
          {hasPermission(ctx, "cases", "create") ? <CreateSplitButton label="Create Case" href="/cases/new" templateModule="cases" /> : null}
        </>
      }
    >
      <nav className="mb-3 flex flex-wrap items-center gap-1" aria-label="Case queues" data-testid="case-queues">
        {QUEUES.map((q) => (
          <Link key={q.id} href={`/cases?queue=${q.id}`} aria-current={q.id === queue ? "page" : undefined} className={cn(tab, q.id === queue ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted")}>
            {q.name}
            {counts[q.id] !== undefined ? <span className="ml-1.5 tabular-nums">{counts[q.id]}</span> : null}
          </Link>
        ))}
        <form method="get" action="/cases" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="queue" value={queue} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Number, subject or customer" aria-label="Search cases" className="h-8 w-64" data-shortcut="search" />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>
      </nav>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No cases in this queue" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="cases-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Case</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">SLA</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50" data-testid="data-row">
                  <td className="px-3 py-2">
                    <Link href={`/cases/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.number}
                    </Link>
                    <div className="max-w-xs truncate">{c.subject}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1">
                      <BrandBadge brand={dir.brands.find((b) => b.id === c.brandId)} />
                      <RegionBadge region={dir.regions.find((r) => r.id === c.regionId)} />
                    </span>
                  </td>
                  <td className="px-3 py-2">{c.contactName ?? c.accountName ?? c.customerName ?? "—"}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[c.type as keyof typeof TYPE_LABELS]}</td>
                  <td className="px-3 py-2">{PRIORITY_LABELS[c.priority as keyof typeof PRIORITY_LABELS]}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status as keyof typeof STATUS_LABELS]}</StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={SLA_TONE[c.sla]}>{SLA_LABEL[c.sla]}</StatusPill>
                    {c.open && c.slaDueAt ? <div className="text-xs text-text-muted">{formatDateTime(c.slaDueAt, prefs.dateFormat)}</div> : null}
                  </td>
                  <td className="px-3 py-2">{c.unassigned ? <StatusPill tone="warning">Unassigned</StatusPill> : c.ownerName}</td>
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
