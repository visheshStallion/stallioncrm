import { forbidden } from "next/navigation";
import { ActionsMenu, CreateSplitButton, FilterPanel, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { MenuItem } from "@/components/crm/overlays";
import { can, hasPermission } from "@/server/access/can";
import { conditionsToWhere, parseConditions, parsePaging, SYSTEM_FILTERS, systemFilterWhere, type FieldDef } from "@/server/list/filters";
import { listAccounts } from "@/server/modules/customers/queries";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from "@/server/modules/customers/schema";
import { canMergeCustomers } from "@/server/modules/customers/service";
import { getColumnLayout } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { CustomerTable } from "./CustomerTable";

export const metadata = { title: "Accounts" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Only BASIC-tier fields can be filtered on – filtering on hidden fields would leak them. */
const FIELDS: FieldDef[] = [
  { key: "name", label: "Account name", type: "text", nullable: false },
  { key: "type", label: "Type", type: "enum", nullable: false, options: ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] })) },
  { key: "city", label: "City", type: "text" },
  { key: "industry", label: "Industry", type: "text" },
  { key: "createdAt", label: "Created time", type: "date", nullable: false },
];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "accounts", "read")) forbidden();
  const viewId = one(sp.view) === "mine" ? "mine" : "all";
  const conditions = parseConditions(sp.f, FIELDS);
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });
  const q = one(sp.q);
  const [{ rows, total }, layout] = await Promise.all([
    listAccounts(ctx, {
      q,
      where: { AND: [conditionsToWhere(conditions, FIELDS), systemFilterWhere(one(sp.sys)), viewId === "mine" ? { ownerId: ctx.userId } : {}] },
      take: paging.per,
      skip: paging.skip,
    }),
    getColumnLayout(ctx, "accounts"),
  ]);

  return (
    <ModuleListFrame
      title={
        <ViewSelector
          current={viewId}
          views={[
            { id: "all", name: "All Accounts", group: "system" },
            { id: "mine", name: "My Accounts", group: "system" },
          ]}
        />
      }
      actions={
        <>
          {can(ctx, "accounts", "create") ? <CreateSplitButton label="Create Account" href="/accounts/new" templateModule="accounts" /> : null}
          <ActionsMenu>
            {canMergeCustomers(ctx) ? <MenuItem href="/accounts/duplicates">Find &amp; merge duplicates</MenuItem> : null}
            {can(ctx, "accounts", "export") ? <MenuItem href={`/api/v1/accounts/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}>Export (CSV)</MenuItem> : null}
            {!canMergeCustomers(ctx) && !can(ctx, "accounts", "export") ? <MenuItem disabled>No actions available</MenuItem> : null}
          </ActionsMenu>
        </>
      }
      filters={
        <FilterPanel
          fields={FIELDS}
          conditions={conditions}
          systemFilters={Object.entries(SYSTEM_FILTERS).map(([key, v]) => ({ key, label: v.label }))}
          searchPlaceholder="Name or full phone number"
        />
      }
    >
      <CustomerTable
        module="accounts"
        basePath="/accounts"
        layout={layout}
        emptyTitle="No accounts found"
        rows={rows.map((r) => ({ ...r, type: ACCOUNT_TYPE_LABELS[r.type as keyof typeof ACCOUNT_TYPE_LABELS] }))}
        columns={[
          { key: "name", label: "Account Name", link: true },
          { key: "type", label: "Type" },
          { key: "phone", label: "Phone", maskedAtBasic: true },
          { key: "email", label: "Email" },
          { key: "city", label: "City" },
          { key: "industry", label: "Industry" },
          { key: "ownerName", label: "Account Owner" },
        ]}
      />
      <Pagination total={total} page={paging.page} per={paging.per} />
    </ModuleListFrame>
  );
}
