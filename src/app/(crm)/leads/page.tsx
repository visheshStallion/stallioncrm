import { forbidden } from "next/navigation";
import { ActionsMenu, CreateSplitButton, FilterPanel, LayoutToggle, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { MenuItem } from "@/components/crm/overlays";
import { ViewActions } from "@/components/crm/ViewActions";
import { can, hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { conditionsToWhere, parseConditions, parsePaging, SYSTEM_FILTERS, systemFilterWhere } from "@/server/list/filters";
import { leadFilterFields, listLeads, listSavedViews } from "@/server/modules/leads/queries";
import { parseLeadFilters, type LeadFilters } from "@/server/modules/leads/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getColumnLayout, getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { LeadsView, type KanbanBy } from "./LeadsView";

export const metadata = { title: "Leads" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function startOfWeek(d = new Date()) {
  const day = (d.getUTCDay() + 6) % 7; // Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

const SYSTEM_VIEWS: Array<{ id: string; name: string; filters: () => LeadFilters }> = [
  { id: "all", name: "All Leads", filters: () => ({}) },
  { id: "open", name: "Open Leads", filters: () => ({ open: true }) },
  { id: "mine", name: "My Open Leads", filters: () => ({ mine: true, open: true }) },
  { id: "hot", name: "Hot Leads This Week", filters: () => ({ rating: "HOT", from: startOfWeek() }) },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "read")) forbidden();

  const [dir, ui, prefs, columnLayout, savedViews, users] = await Promise.all([
    getDirectory(ctx),
    getUiFilters(ctx),
    getPreferences(ctx),
    getColumnLayout(ctx, "leads"),
    listSavedViews(ctx),
    scopedDb(ctx).user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const viewId = one(sp.view) ?? "open";
  const system = SYSTEM_VIEWS.find((v) => v.id === viewId);
  const saved = savedViews.find((v) => v.id === viewId);
  const savedFilters = (saved?.filters ?? {}) as Record<string, unknown>;
  const fields = leadFilterFields({ brands: dir.myBrands, regions: dir.myRegions, users });

  // The view's filters, then the user's panel filters on top (they narrow, never replace).
  const base: LeadFilters = system ? system.filters() : saved ? parseLeadFilters(savedFilters as Record<string, string>) : SYSTEM_VIEWS[1]!.filters();
  const q = one(sp.q)?.trim();
  const filters: LeadFilters = {
    ...base,
    ...(q ? { q } : {}),
    ...(ui.brandId ? { brandId: ui.brandId } : {}),
    ...(ui.regionId ? { regionId: ui.regionId } : {}),
  };
  const urlConds = parseConditions(sp.f, fields);
  const savedConds = saved ? parseConditions(savedFilters.f as string[] | undefined, fields) : [];
  const conditions = urlConds.length ? urlConds : savedConds;
  const sys = one(sp.sys) ?? (saved ? (savedFilters.sys as string | undefined) : undefined);

  const layout = one(sp.layout) === "kanban" ? "kanban" : "list";
  const by = (["status", "rating", "source"].includes(one(sp.by) ?? "") ? one(sp.by) : "status") as KanbanBy;
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });
  const extraWhere = { AND: [conditionsToWhere(conditions, fields), systemFilterWhere(sys)] };
  const { rows, total } = await listLeads(ctx, filters, {
    where: extraWhere,
    ...(layout === "kanban" ? { take: 500 } : { take: paging.per, skip: paging.skip }),
  });

  const exportHref = can(ctx, "leads", "export")
    ? `/api/v1/leads/export?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString()}`
    : null;
  const views = [
    ...SYSTEM_VIEWS.map((v) => ({ id: v.id, name: v.name, group: "system" as const })),
    ...savedViews.map((v) => ({ id: v.id, name: v.name, group: "mine" as const })),
  ];

  return (
    <ModuleListFrame
      title={<ViewSelector views={views} current={saved ? saved.id : system ? system.id : "open"} />}
      actions={
        <>
          {can(ctx, "leads", "create") ? <CreateSplitButton label="Create Lead" href="/leads/new" /> : null}
          <ActionsMenu>
            <ViewActions module="leads" filters={{ ...base, ...(q ? { q } : {}), f: conditions.map((c) => [c.field, c.op, c.value ?? "", c.value2 ?? ""].join("~")), ...(sys ? { sys } : {}) }} savedViewId={saved?.id ?? null} />
            {exportHref ? <MenuItem href={exportHref}>Export view (CSV)</MenuItem> : null}
          </ActionsMenu>
          <LayoutToggle layout={layout} />
        </>
      }
      filters={
        <FilterPanel
          fields={fields}
          conditions={conditions}
          systemFilters={Object.entries(SYSTEM_FILTERS).map(([key, v]) => ({ key, label: v.label }))}
          searchPlaceholder="Search name, mobile, email"
        />
      }
    >
      <LeadsView
        layout={layout}
        kanbanBy={by}
        rows={rows}
        brands={dir.brands}
        regions={dir.regions}
        users={users}
        canEdit={can(ctx, "leads", "edit")}
        canMassUpdate={can(ctx, "leads", "massUpdate")}
        exportHref={exportHref}
        dateFormat={prefs.dateFormat}
        columnLayout={columnLayout}
      />
      {layout === "list" ? <Pagination total={total} page={paging.page} per={paging.per} /> : null}
    </ModuleListFrame>
  );
}
