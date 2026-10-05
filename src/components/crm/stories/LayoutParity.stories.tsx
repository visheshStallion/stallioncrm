import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { BrandLogoStrip } from "@/components/BrandLogo";
import { DataTable } from "@/components/DataTable";
import { Kanban } from "@/components/Kanban";
import { toast, Toaster } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { BrandSwitcher } from "../BrandSwitcher";
import { ClassicNav } from "../ClassicNav";
import { GlobalSearch } from "../GlobalSearch";
import { ActionsMenu, CreateSplitButton, FilterPanel, LayoutToggle, ModuleListFrame, Pagination, ViewSelector } from "../ListPage";
import { ModuleRail } from "../ModuleRail";
import { DEFAULT_PINNED, RAIL_ORDER } from "../nav-config";
import { MenuItem, Modal } from "../overlays";
import { PageTitleRow, StatusPill } from "../primitives";
import { DetailTabs, Field, FieldSection, FormSection, RecordHeader, RelatedListCard, RelatedNav, Required, StageProgressBar, StickyFormFooter } from "../record";
import { AvatarMenu, CalendarShortcut, NotificationsBell, SetupGear } from "../UserMenus";

/**
 * The calibrated layout (docs/ZOHO_LAYOUT_SPEC.md): one story per region that is compared with the reference
 * screenshots. Sizes and colours come from src/styles/tokens.css – switch density and theme in the toolbar.
 */
const meta = { title: "CRM/Layout parity", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const BRANDS = [
  { id: "b1", code: "HMNL", name: "Hyundai", color: "#1d4ed8", hasLogo: false },
  { id: "b2", code: "SNMNL", name: "Nissan", color: "#be123c", hasLogo: false },
  { id: "b3", code: "SMGL", name: "MG", color: "#047857", hasLogo: false },
];
const RAIL_PREFS = { order: RAIL_ORDER.map((i) => i.key), pinned: DEFAULT_PINNED, collapsed: true };
const railItems = RAIL_ORDER.map((i) => (i.key === "activities" ? { ...i, badge: 3 } : i));

function HeaderBar({ classic = false }: { classic?: boolean }) {
  return (
    <header className="crm-header">
      {classic ? (
        <span className="crm-logo">
          <span className="crm-logo-mark">SC</span>
          StallionCRM
        </span>
      ) : null}
      <BrandLogoStrip brands={BRANDS} />
      <BrandSwitcher brands={BRANDS.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))} regions={[{ id: "r1", label: "Lagos" }]} brandId={null} regionId={null} />
      <GlobalSearch brands={BRANDS} />
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className="crm-quick-create" aria-label="Quick create">
          +
        </button>
        <CalendarShortcut />
        <NotificationsBell count={4} items={[{ id: "n1", kind: "ASSIGNMENT", title: "Lead assigned to you", body: "Tola Adewale – HMNL", href: "#", read: false, at: "now" }]} />
        <SetupGear />
        <AvatarMenu
          user={{ name: "Ada Okafor", email: "ada@example.test", roleName: "Lagos Sales Exec", profileName: "Sales Exec" }}
          prefs={{ theme: "light", density: "standard", dateFormat: "DD/MM/YYYY", nav: classic ? "classic" : "sidebar" }}
          logout={async () => {}}
        />
      </div>
    </header>
  );
}

export const Header: Story = { render: () => <HeaderBar /> };

export const Sidebar: Story = {
  render: () => (
    <div className="flex h-[640px] gap-6">
      {/* `md:flex` hides the rail on phone widths; the story forces both states side by side */}
      <ModuleRail items={railItems} prefs={RAIL_PREFS} brand={BRANDS[0]} isAdmin />
      <ModuleRail items={railItems} prefs={{ ...RAIL_PREFS, collapsed: false }} isAdmin />
    </div>
  ),
};

export const ClassicNavigation: Story = {
  render: () => (
    <div>
      <HeaderBar classic />
      <ClassicNav items={railItems} prefs={RAIL_PREFS} />
    </div>
  ),
};

type Row = { id: string; name: string; brand: string; amount: number; stage: string; owner: string };
const rows: Row[] = Array.from({ length: 14 }, (_, i) => ({
  id: String(i),
  name: `${["HMNL", "SNMNL", "SMGL"][i % 3]} SUV – Customer ${String.fromCharCode(65 + i)}`,
  brand: ["HMNL", "SNMNL", "SMGL"][i % 3]!,
  amount: 15_000_000 + i * 2_250_000,
  stage: ["Enquiry", "Test Drive", "Quotation"][i % 3]!,
  owner: ["Ada Okafor", "Segun Ajayi", "Kunle Bakare"][i % 3]!,
}));
const brandOf = (code: string) => BRANDS.find((b) => b.code === code);
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Deal Name", cell: ({ row }) => <a href="#">{row.original.name}</a> },
  { accessorKey: "brand", header: "Brand", cell: ({ row }) => <BrandBadge brand={brandOf(row.original.brand)} /> },
  { accessorKey: "amount", header: "Amount", cell: ({ row }) => formatMoney(row.original.amount) },
  { accessorKey: "stage", header: "Stage", cell: ({ row }) => <StatusPill tone="primary">{row.original.stage}</StatusPill> },
  { accessorKey: "owner", header: "Owner" },
];

function ListFrame({ layout }: { layout: "list" | "kanban" }) {
  return (
    <div className="crm-main">
      <ModuleListFrame
        title={<ViewSelector views={[{ id: "all", name: "All Deals", group: "system" }, { id: "x", name: "Lagos SUVs", group: "mine" }]} current="all" />}
        actions={
          <>
            <CreateSplitButton label="Create Deal" href="#" importHref="#" />
            <ActionsMenu>
              <MenuItem>Mass update</MenuItem>
              <MenuItem>Export</MenuItem>
            </ActionsMenu>
            <LayoutToggle layout={layout} />
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
            systemFilters={[
              { key: "touched", label: "Touched records" },
              { key: "untouched", label: "Untouched records" },
            ]}
          />
        }
      >
        {layout === "list" ? (
          <>
            <DataTable columns={columns} data={rows} selectable bulkBar={() => <Button size="sm" variant="outline">Mass update</Button>} rowActions={() => <Button size="sm" variant="ghost">Edit</Button>} />
            <Pagination total={248} page={1} per={20} />
          </>
        ) : (
          <Kanban
            onMove={async () => true}
            columns={["Enquiry", "Test Drive", "Quotation", "Booking"].map((stage, s) => ({
              key: stage,
              label: stage,
              cards: rows
                .filter((_, i) => i % 4 === s)
                .map((r) => ({ id: r.id, title: r.name, subtitle: "Customer account", href: "#", amount: r.amount, date: "31/10/2026", ownerName: r.owner, brand: brandOf(r.brand) })),
            }))}
          />
        )}
      </ModuleListFrame>
    </div>
  );
}

export const ListView: Story = { render: () => <ListFrame layout="list" /> };
export const KanbanView: Story = { render: () => <ListFrame layout="kanban" /> };

const STAGES = ["Enquiry", "Test Drive", "Quotation", "Booking", "Finance / Payment", "Delivery", "Closed Won"].map((l) => ({ key: l, label: l }));

export const RecordDetail: Story = {
  render: () => (
    <div className="crm-main">
      <RecordHeader
        backHref="#"
        brand={BRANDS[0]}
        moduleLabel="Deal"
        title="HMNL SUV – Acme Logistics"
        owner="Ada Okafor"
        meta={<StatusPill tone="primary">Quotation</StatusPill>}
        actions={
          <>
            <Button variant="outline">Send Email</Button>
            <Button variant="outline">Edit</Button>
          </>
        }
      />
      <StageProgressBar stages={STAGES} current="Quotation" />
      <DetailTabs current="overview" tabs={[{ key: "overview", label: "Overview", href: "#" }, { key: "timeline", label: "Timeline", href: "#" }]} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <RelatedNav items={[{ id: "info", label: "Deal Information" }, { id: "notes", label: "Notes", count: 2 }, { id: "act", label: "Open Activities", count: 1 }]} />
        <div className="min-w-0 flex-1 space-y-3">
          <FieldSection title="Deal Information" id="info">
            <Field label="Deal name" value="HMNL SUV – Acme Logistics" />
            <Field label="Amount" value="₦ 32,500,000.00" />
            <Field label="Customer phone" value="0803****21" masked />
            <Field label="Closing date" value="31/10/2026" />
          </FieldSection>
          <RelatedListCard id="notes" title="Notes" count={2} newHref="#">
            <p>Customer asked for a fleet discount.</p>
          </RelatedListCard>
        </div>
      </div>
    </div>
  ),
};

export const Form: Story = {
  render: () => (
    <div className="crm-main">
      <div className="mx-auto max-w-5xl">
        <PageTitleRow title="Create Deal" />
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <FormSection title="Deal Information">
            <div className="space-y-1">
              <Label htmlFor="f-name">
                Deal name
                <Required />
              </Label>
              <Input id="f-name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-brand">
                Brand
                <Required />
              </Label>
              <Select id="f-brand" className="w-full">
                <option>Choose brand…</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-amount">Amount</Label>
              <Input id="f-amount" type="number" />
            </div>
          </FormSection>
          <StickyFormFooter cancelHref="#" saveAndNew={<Button variant="outline">Save and New</Button>}>
            <Button>Save</Button>
          </StickyFormFooter>
        </form>
      </div>
    </div>
  ),
};

function ModalDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open quick create</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Quick create: Deal"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="m-name">
              Deal name
              <Required />
            </Label>
            <Input id="m-name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="m-amount">Amount (₦)</Label>
            <Input id="m-amount" type="number" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

export const QuickCreateModal: Story = { render: () => <ModalDemo /> };

export const Toasts: Story = {
  render: () => (
    <div className="flex gap-2 p-6">
      <Button onClick={() => toast("Deal saved", "success")}>Success</Button>
      <Button variant="outline" onClick={() => toast("You do not have permission to do that", "error")}>
        Error
      </Button>
      <Button variant="outline" onClick={() => toast("Export is being prepared", "info")}>
        Info
      </Button>
      <span data-tip="Tooltips use the same dark surface" tabIndex={0} className="self-center text-sm underline">
        Hover for a tooltip
      </span>
      <Toaster />
    </div>
  ),
};
