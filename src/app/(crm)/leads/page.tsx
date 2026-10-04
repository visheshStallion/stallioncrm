import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { Kanban } from "@/components/Kanban";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { can, hasPermission } from "@/server/access/can";
import { getDirectory } from "@/server/modules/org/queries";
import { listLeads, listSavedViews } from "@/server/modules/leads/queries";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  RATINGS,
  SOURCE_LABELS,
  STATUS_LABELS,
  parseLeadFilters,
  type LeadFilters,
} from "@/server/modules/leads/schema";
import { getUiFilters, requireContext } from "@/server/request";
import { scopedDb } from "@/server/db";
import { deleteViewAction } from "@/server/modules/leads/actions";
import { DeleteViewButton } from "./DeleteViewButton";
import { LeadsList, SearchBox, visibilityFromColumns } from "./LeadsList";

export const metadata = { title: "Leads" };

function startOfWeek(d = new Date()) {
  const day = (d.getUTCDay() + 6) % 7; // Monday
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return s.toISOString().slice(0, 10);
}

const BUILT_IN: Array<{ id: string; name: string; filters: () => LeadFilters }> = [
  { id: "open", name: "Open leads", filters: () => ({ open: true }) },
  { id: "mine", name: "My open leads", filters: () => ({ mine: true, open: true }) },
  { id: "hot", name: "Hot leads this week", filters: () => ({ rating: "HOT", from: startOfWeek() }) },
  { id: "all", name: "All leads", filters: () => ({}) },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "read")) forbidden();

  const [dir, uiFilters, savedViews] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), listSavedViews(ctx)]);
  const viewId = sp.view ?? "open";
  const builtIn = BUILT_IN.find((v) => v.id === viewId);
  const saved = savedViews.find((v) => v.id === viewId);
  const explicit = parseLeadFilters(sp);
  const hasExplicit = Object.keys(explicit).length > 0;
  // Explicit filters narrow the selected view (they are layered on top, never replace it).
  const filters: LeadFilters = {
    ...(builtIn ? builtIn.filters() : saved ? parseLeadFilters(saved.filters as Record<string, string>) : {}),
    ...explicit,
    // Top-bar brand switcher / region filter narrow every list.
    ...(uiFilters.brandId && !explicit.brandId ? { brandId: uiFilters.brandId } : {}),
    ...(uiFilters.regionId && !explicit.regionId ? { regionId: uiFilters.regionId } : {}),
  };
  const layout = sp.layout === "kanban" ? "kanban" : "list";
  const { rows, total } = await listLeads(ctx, filters, { take: layout === "kanban" ? 500 : 1000 });
  const owners = await scopedDb(ctx).user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const exportHref = can(ctx, "leads", "export")
    ? `/api/v1/leads/export?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString()}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground" data-testid="lead-total">
            {total} lead(s)
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-border">
            <Link href={`/leads${qs({ layout: undefined })}`} className={cn("px-3 py-1.5 text-sm", layout === "list" && "bg-muted font-medium")}>
              List
            </Link>
            <Link href={`/leads${qs({ layout: "kanban" })}`} className={cn("px-3 py-1.5 text-sm", layout === "kanban" && "bg-muted font-medium")}>
              Kanban
            </Link>
          </div>
          {can(ctx, "leads", "create") ? (
            <Button asChild>
              <Link href="/leads/new">New lead</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Views" data-testid="lead-views">
        {[...BUILT_IN, ...savedViews.map((v) => ({ id: v.id, name: v.name }))].map((v) => (
          <Link
            key={v.id}
            href={`/leads?view=${v.id}${layout === "kanban" ? "&layout=kanban" : ""}`}
            className={cn("rounded-full border border-border px-3 py-1", viewId === v.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {v.name}
          </Link>
        ))}
        {saved ? <DeleteViewButton id={saved.id} action={deleteViewAction} /> : null}
      </nav>

      <form className="flex flex-wrap items-end gap-2" data-testid="lead-filters">
        <input type="hidden" name="view" value={viewId} />
        {layout === "kanban" ? <input type="hidden" name="layout" value="kanban" /> : null}
        <SearchBox defaultValue={filters.q} />
        <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={filters.source ?? ""} aria-label="Source">
          <option value="">Any source</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select name="rating" defaultValue={filters.rating ?? ""} aria-label="Rating">
          <option value="">Any rating</option>
          {RATINGS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        {/* Brand / region filters only offer values the user can see. */}
        <Select name="brandId" defaultValue={filters.brandId ?? ""} aria-label="Brand">
          <option value="">All my brands</option>
          {dir.myBrands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </Select>
        <Select name="regionId" defaultValue={filters.regionId ?? ""} aria-label="Region filter">
          <option value="">All my regions</option>
          {dir.myRegions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select name="ownerId" defaultValue={filters.ownerId ?? ""} aria-label="Owner">
          <option value="">Any owner</option>
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={filters.from} aria-label="Created from" className="w-40" />
        <Input type="date" name="to" defaultValue={filters.to} aria-label="Created to" className="w-40" />
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {hasExplicit ? (
          <Link href={`/leads?view=${viewId}`} className="text-sm underline">
            Reset
          </Link>
        ) : null}
      </form>

      {layout === "kanban" ? (
        <Kanban
          columns={LEAD_STATUSES.map((s) => ({
            key: s,
            label: STATUS_LABELS[s],
            cards: rows
              .filter((r) => r.status === s)
              .map((r) => ({
                id: r.id,
                title: r.name,
                subtitle: [r.modelName, r.ownerName].filter(Boolean).join(" · "),
                href: `/leads/${r.id}`,
                badges: (
                  <>
                    <BrandBadge brand={dir.brands.find((b) => b.id === r.brandId)} />
                    <RegionBadge region={dir.regions.find((x) => x.id === r.regionId)} />
                    {r.rating ? <span className="text-[11px] font-semibold">{r.rating}</span> : null}
                  </>
                ),
              })),
          }))}
        />
      ) : (
        <Card>
          <CardContent className="pt-5">
            <LeadsList
              rows={rows}
              brands={dir.brands}
              regions={dir.regions}
              users={owners}
              canMassUpdate={can(ctx, "leads", "massUpdate")}
              exportHref={exportHref}
              filters={filters}
              columnVisibility={saved ? visibilityFromColumns(saved.columns) : null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
