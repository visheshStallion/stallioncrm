import { forbidden } from "next/navigation";
import { fieldMaskView } from "@/server/access/field-mask";
import { ActionsMenu, CreateSplitButton, FilterPanel, LayoutToggle, ModuleListFrame, Pagination, ViewSelector, type ViewOption } from "@/components/crm/ListPage";
import { ViewActions } from "@/components/crm/ViewActions";
import { can, hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { conditionsToWhere, parseConditions, parsePaging, SYSTEM_FILTERS, systemFilterWhere } from "@/server/list/filters";
import { listSavedViews } from "@/server/modules/leads/queries";
import { customFilterFields } from "@/server/modules/customization/service";
import { dealFilterFields, dealFormLookups, listDeals, listPipelines, OPEN_DEALS } from "@/server/modules/deals/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getColumnLayout, getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { DealsView } from "./DealsView";
import { PipelinePicker } from "./PipelinePicker";

export const metadata = { title: "Deals" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function monthRange() {
  const n = new Date();
  return { gte: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)), lt: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)) };
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "read")) forbidden();

  const [dir, ui, prefs, columnLayout, users, allPipelines, savedViews, lookups] = await Promise.all([
    getDirectory(ctx),
    getUiFilters(ctx),
    getPreferences(ctx),
    getColumnLayout(ctx, "deals"),
    scopedDb(ctx).user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listPipelines(ctx),
    listSavedViews(ctx, "deals"),
    dealFormLookups(ctx),
  ]);

  const SYSTEM: Array<ViewOption & { where: () => object }> = [
    { id: "all", name: "All Deals", group: "system", where: () => ({}) },
    { id: "open", name: "Open Deals", group: "system", where: () => OPEN_DEALS },
    { id: "mine", name: "My Deals", group: "system", where: () => ({ ownerId: ctx.userId }) },
    { id: "closing", name: "Closing This Month", group: "system", where: () => ({ ...OPEN_DEALS, closeDate: monthRange() }) },
  ];
  const viewId = one(sp.view) ?? "all";
  const saved = savedViews.find((v) => v.id === viewId);
  const savedFilters = (saved?.filters ?? {}) as { base?: string; q?: string; f?: string[]; sys?: string };
  const base = SYSTEM.find((v) => v.id === (saved ? savedFilters.base : viewId)) ?? SYSTEM[0]!;

  // Pipelines: only those of the user's brands; the brand switcher narrows them further.
  const pipelines = allPipelines.filter((p) => !ui.brandId || p.brandId === ui.brandId);
  const requested = one(sp.pipeline);
  const selected = pipelines.find((p) => p.id === requested) ?? (pipelines.length === 1 ? pipelines[0]! : null);
  const boards = selected ? [selected] : pipelines.filter((p) => p.isDefault);

  const stageKeys = [...new Map((selected ? selected.stages : pipelines.flatMap((p) => p.stages)).map((s) => [s.key, { key: s.key, name: s.name }])).values()];
  const fields = [...dealFilterFields({ brands: dir.myBrands, regions: dir.myRegions, users, stageKeys }), ...(await customFilterFields(ctx, "deals"))];
  const urlConds = parseConditions(sp.f, fields);
  const conditions = urlConds.length ? urlConds : saved ? parseConditions(savedFilters.f, fields) : [];
  const q = (one(sp.q) ?? (saved ? savedFilters.q : undefined))?.trim();
  const sys = one(sp.sys) ?? (saved ? savedFilters.sys : undefined);
  const layout = one(sp.layout) === "kanban" ? "kanban" : "list";
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });

  const where = {
    AND: [
      base.where(),
      selected ? { pipelineId: selected.id } : {},
      conditionsToWhere(conditions, fields),
      systemFilterWhere(sys),
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { vinChassisNo: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const found = await listDeals(ctx, ui, { where, ...(layout === "kanban" ? { take: 1000 } : { take: paging.per, skip: paging.skip }) });
  // field-level security of the profile (hidden → "—", masked → partly shown)
  const rows = found.rows.map((r) => fieldMaskView(ctx, "deals", r));
  const total = found.total;

  return (
    <ModuleListFrame
      title={
        <>
          <ViewSelector views={[...SYSTEM.map(({ id, name, group }) => ({ id, name, group })), ...savedViews.map((v) => ({ id: v.id, name: v.name, group: "mine" as const }))]} current={saved ? saved.id : base.id} />
          <PipelinePicker
            current={selected?.id ?? ""}
            pipelines={pipelines.map((p) => ({ id: p.id, label: `${dir.brands.find((b) => b.id === p.brandId)?.code ?? "?"} – ${p.name}` }))}
          />
        </>
      }
      actions={
        <>
          {can(ctx, "deals", "create") ? <CreateSplitButton label="Create Deal" href="/deals/new" /> : null}
          <ActionsMenu>
            <ViewActions module="deals" savedViewId={saved?.id ?? null} filters={{ base: base.id, ...(q ? { q } : {}), f: conditions.map((c) => [c.field, c.op, c.value ?? "", c.value2 ?? ""].join("~")), ...(sys ? { sys } : {}) }} />
          </ActionsMenu>
          <LayoutToggle layout={layout} />
        </>
      }
      filters={
        <FilterPanel
          fields={fields}
          conditions={conditions}
          systemFilters={Object.entries(SYSTEM_FILTERS).map(([key, v]) => ({ key, label: v.label }))}
          searchPlaceholder="Deal, customer or VIN"
        />
      }
    >
      <DealsView
        layout={layout}
        rows={rows}
        brands={dir.brands}
        regions={dir.regions}
        pipelines={boards}
        products={lookups.products}
        canEdit={can(ctx, "deals", "edit")}
        dateFormat={prefs.dateFormat}
        columnLayout={columnLayout}
      />
      {layout === "list" ? (
        <Pagination total={total} page={paging.page} per={paging.per} />
      ) : (
        <p className="text-[13px] text-text-muted">
          Total Records <strong className="text-text" data-testid="total-records">{total}</strong>
        </p>
      )}
    </ModuleListFrame>
  );
}
