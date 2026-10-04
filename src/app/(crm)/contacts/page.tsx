import { forbidden } from "next/navigation";
import { ActionsMenu, CreateSplitButton, FilterPanel, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { MenuItem } from "@/components/crm/overlays";
import { can, hasPermission } from "@/server/access/can";
import { conditionsToWhere, parseConditions, parsePaging, SYSTEM_FILTERS, systemFilterWhere, type FieldDef } from "@/server/list/filters";
import { listContacts } from "@/server/modules/customers/queries";
import { getColumnLayout } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { CustomerTable } from "../accounts/CustomerTable";

export const metadata = { title: "Contacts" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Only BASIC-tier fields can be filtered on. */
const FIELDS: FieldDef[] = [
  { key: "lastName", label: "Last name", type: "text", nullable: false },
  { key: "firstName", label: "First name", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "createdAt", label: "Created time", type: "date", nullable: false },
];

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "contacts", "read")) forbidden();
  const viewId = one(sp.view) === "mine" ? "mine" : "all";
  const conditions = parseConditions(sp.f, FIELDS);
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });
  const q = one(sp.q);
  const [{ rows, total }, layout] = await Promise.all([
    listContacts(ctx, {
      q,
      where: { AND: [conditionsToWhere(conditions, FIELDS), systemFilterWhere(one(sp.sys)), viewId === "mine" ? { ownerId: ctx.userId } : {}] },
      take: paging.per,
      skip: paging.skip,
    }),
    getColumnLayout(ctx, "contacts"),
  ]);
  return (
    <ModuleListFrame
      title={
        <ViewSelector
          current={viewId}
          views={[
            { id: "all", name: "All Contacts", group: "system" },
            { id: "mine", name: "My Contacts", group: "system" },
          ]}
        />
      }
      actions={
        <>
          {can(ctx, "contacts", "create") ? <CreateSplitButton label="Create Contact" href="/contacts/new" /> : null}
          {can(ctx, "contacts", "export") ? (
            <ActionsMenu>
              <MenuItem href={`/api/v1/contacts/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}>Export (CSV)</MenuItem>
            </ActionsMenu>
          ) : null}
        </>
      }
      filters={
        <FilterPanel
          fields={FIELDS}
          conditions={conditions}
          systemFilters={Object.entries(SYSTEM_FILTERS).map(([key, v]) => ({ key, label: v.label }))}
          searchPlaceholder="Name, account or full mobile"
        />
      }
    >
      <CustomerTable
        module="contacts"
        basePath="/contacts"
        layout={layout}
        emptyTitle="No contacts found"
        rows={rows.map((r) => ({ ...r }))}
        columns={[
          { key: "name", label: "Contact Name", link: true },
          { key: "accountName", label: "Account Name", link: true, linkKey: "accountId", linkBase: "/accounts" },
          { key: "mobile", label: "Mobile", maskedAtBasic: true },
          { key: "email", label: "Email" },
          { key: "city", label: "City" },
          { key: "ownerName", label: "Contact Owner" },
        ]}
      />
      <Pagination total={total} page={paging.page} per={paging.per} />
    </ModuleListFrame>
  );
}
