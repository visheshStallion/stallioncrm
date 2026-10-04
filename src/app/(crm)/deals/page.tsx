import { forbidden } from "next/navigation";
import { ActionsMenu, FilterPanel, LayoutToggle, ModuleListFrame, Pagination, ViewSelector, type ViewOption } from "@/components/crm/ListPage";
import { MenuItem } from "@/components/crm/overlays";
import { can, hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { conditionsToWhere, parseConditions, parsePaging, SYSTEM_FILTERS, systemFilterWhere } from "@/server/list/filters";
import { dealFilterFields, listDeals } from "@/server/modules/deals/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getColumnLayout, getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { DealsView } from "./DealsView";

export const metadata = { title: "Deals" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function monthRange() {
  const n = new Date();
  return {
    gte: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)),
    lt: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)),
  };
}

const OPEN = { stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ("CLOSED_WON" | "CLOSED_LOST")[] } };

export default async function DealsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "read")) forbidden();

  const [dir, ui, prefs, columnLayout, users] = await Promise.all([
    getDirectory(ctx),
    getUiFilters(ctx),
    getPreferences(ctx),
    getColumnLayout(ctx, "deals"),
    scopedDb(ctx).user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const VIEWS: Array<ViewOption & { where: () => object }> = [
    { id: "all", name: "All Deals", group: "system", where: () => ({}) },
    { id: "open", name: "Open Deals", group: "system", where: () => OPEN },
    { id: "mine", name: "My Deals", group: "system", where: () => ({ ownerId: ctx.userId }) },
    { id: "closing", name: "Closing This Month", group: "system", where: () => ({ ...OPEN, closeDate: monthRange() }) },
  ];
  const viewId = one(sp.view) ?? "all";
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0]!;
  const fields = dealFilterFields({ brands: dir.myBrands, regions: dir.myRegions, users });
  const conditions = parseConditions(sp.f, fields);
  const q = one(sp.q)?.trim();
  const layout = one(sp.layout) === "kanban" ? "kanban" : "list";
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });

  const where = {
    AND: [
      view.where(),
      conditionsToWhere(conditions, fields),
      systemFilterWhere(one(sp.sys)),
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const { rows, total } = await listDeals(ctx, ui, {
    where,
    ...(layout === "kanban" ? { take: 500 } : { take: paging.per, skip: paging.skip }),
  });

  return (
    <ModuleListFrame
      title={<ViewSelector views={VIEWS.map(({ id, name, group }) => ({ id, name, group }))} current={view.id} />}
      actions={
        <>
          <LayoutToggle layout={layout} />
          <ActionsMenu>
            <MenuItem disabled>Mass update (prompt 04)</MenuItem>
            <MenuItem disabled={!can(ctx, "deals", "export")}>Export (prompt 12)</MenuItem>
          </ActionsMenu>
        </>
      }
      filters={
        <FilterPanel
          fields={fields}
          conditions={conditions}
          systemFilters={Object.entries(SYSTEM_FILTERS).map(([key, v]) => ({ key, label: v.label }))}
          searchPlaceholder="Search deals"
        />
      }
    >
      <DealsView
        layout={layout}
        rows={rows}
        brands={dir.brands}
        regions={dir.regions}
        canEdit={can(ctx, "deals", "edit")}
        dateFormat={prefs.dateFormat}
        columnLayout={columnLayout}
      />
      {layout === "list" ? <Pagination total={total} page={paging.page} per={paging.per} /> : <p className="text-[13px] text-text-muted" data-testid="total-records">{total}</p>}
    </ModuleListFrame>
  );
}
