import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { BrandBadge } from "@/components/BrandBadge";
import { DataTable } from "@/components/DataTable";
import { Kanban } from "@/components/Kanban";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { ActionsMenu, CreateSplitButton, FilterPanel, LayoutToggle, ModuleListFrame, Pagination, ViewSelector } from "../ListPage";
import { MenuItem } from "../overlays";
import { StatusPill } from "../primitives";
import { SetupLanding } from "../SetupLayout";

const meta = { title: "CRM/List, kanban & setup", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

type Row = { id: string; name: string; brand: string; amount: number; stage: string };
const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  name: `Deal ${i + 1} – Customer ${String.fromCharCode(65 + i)}`,
  brand: ["HMNL", "SNMNL", "SMGL"][i % 3]!,
  amount: 15_000_000 + i * 2_250_000,
  stage: ["Enquiry", "Test Drive", "Quotation"][i % 3]!,
}));
const COLORS: Record<string, string> = { HMNL: "#1d4ed8", SNMNL: "#be123c", SMGL: "#047857" };
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Deal Name" },
  { accessorKey: "brand", header: "Brand", cell: ({ row }) => <BrandBadge brand={{ code: row.original.brand, color: COLORS[row.original.brand] }} /> },
  { accessorKey: "amount", header: "Amount", cell: ({ row }) => formatMoney(row.original.amount) },
  { accessorKey: "stage", header: "Stage", cell: ({ row }) => <StatusPill tone="primary">{row.original.stage}</StatusPill>, meta: { editable: { type: "select", options: [{ value: "Enquiry", label: "Enquiry" }] } } },
];

export const ModuleListPage: Story = {
  render: () => (
    <ModuleListFrame
      title={<ViewSelector views={[{ id: "all", name: "All Deals", group: "system" }, { id: "x", name: "Lagos SUVs", group: "mine" }]} current="all" />}
      actions={
        <>
          <CreateSplitButton label="Create Deal" href="#" importHref="#" />
          <ActionsMenu>
            <MenuItem>Mass update</MenuItem>
            <MenuItem>Export</MenuItem>
          </ActionsMenu>
          <LayoutToggle layout="list" />
        </>
      }
      filters={
        <FilterPanel
          fields={[
            { key: "name", label: "Deal name", type: "text" },
            { key: "stage", label: "Stage", type: "enum", options: [{ value: "ENQUIRY", label: "Enquiry" }] },
            { key: "amount", label: "Amount", type: "number" },
            { key: "closeDate", label: "Closing date", type: "date" },
          ]}
          conditions={[{ field: "amount", op: "gt", value: "20000000" }]}
          systemFilters={[{ key: "touched", label: "Touched records" }]}
        />
      }
    >
      <DataTable columns={columns} data={rows} selectable bulkBar={() => <Button size="sm" variant="outline">Mass update</Button>} onCellEdit={async () => true} />
      <Pagination total={248} page={1} per={20} />
    </ModuleListFrame>
  ),
};

export const ModuleKanban: Story = {
  render: () => (
    <Kanban
      kanbanBy={{ current: "stage", options: [{ value: "stage", label: "Stage" }] }}
      onMove={async () => true}
      columns={["Enquiry", "Test Drive", "Quotation"].map((s) => ({
        key: s,
        label: s,
        cards: rows
          .filter((r) => r.stage === s)
          .map((r, i) => ({ id: r.id, title: r.name, subtitle: "Acme Logistics", amount: r.amount, date: "31/10/2026", ownerName: "Ada Okafor", brand: { code: r.brand, color: COLORS[r.brand] }, stale: i === 0 })),
      }))}
    />
  ),
};

export const Virtualised1000Rows: Story = {
  render: () => (
    <DataTable
      columns={columns}
      data={Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `Deal ${i + 1}`, brand: "HMNL", amount: 1_000_000 + i, stage: "Enquiry" }))}
    />
  ),
};

export const SetupLandingGrid: Story = {
  render: () => (
    <SetupLanding
      categories={[
        { key: "u", title: "Users & Control", description: "Users, roles and profiles", items: [{ href: "#", label: "Users", available: true }, { href: "#", label: "Profiles", available: true }] },
        { key: "b", title: "Brands & Territories", description: "Brand master and territories", items: [{ href: "#", label: "Brands", available: true }] },
        { key: "d", title: "Developer Space", description: "API keys and webhooks", items: [{ href: "#", label: "API & webhooks", available: false }] },
      ]}
    />
  ),
};
