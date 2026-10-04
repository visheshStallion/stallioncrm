import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CurrencyInput, DateRangePicker, EditableField, LookupField, MultiPicklist, OwnerPicker, Picklist } from "../fields";
import { ConfirmDialog, Drawer, DropdownMenu, MenuItem } from "../overlays";

const meta = { title: "CRM/Fields & overlays", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const users = [
  { id: "1", name: "Ada Okafor" },
  { id: "2", name: "Tobi Akande" },
];

export const Inputs: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <Picklist name="stage" options={[{ value: "a", label: "Enquiry" }, { value: "b", label: "Test Drive" }]} aria-label="Stage" />
      <MultiPicklist name="brands" options={[{ value: "HMNL", label: "HMNL" }, { value: "SMGL", label: "SMGL" }, { value: "THPL", label: "THPL" }]} defaultValue={["HMNL"]} />
      <CurrencyInput name="amount" defaultValue={12500000} />
      <DateRangePicker fromName="from" toName="to" />
      <OwnerPicker name="owner" users={users} defaultValue="1" />
      <LookupField name="model" brandId="b1" items={[{ id: "m1", name: "HMNL SUV", brandId: "b1" }, { id: "m2", name: "SMGL Sedan", brandId: "b2" }]} />
      <dl>
        <EditableField label="City" display="Lagos" editor={<input defaultValue="Lagos" className="rounded border px-1" aria-label="City" />} canEdit />
      </dl>
    </div>
  ),
};

function OverlaysDemo() {
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex gap-2">
      <DropdownMenu label="Actions" trigger={({ toggle }) => <Button onClick={toggle}>Actions ▾</Button>}>
        <MenuItem>Mass update</MenuItem>
        <MenuItem>Export</MenuItem>
      </DropdownMenu>
      <Button variant="outline" onClick={() => setDrawer(true)}>
        Quick create drawer
      </Button>
      <Button variant="destructive" onClick={() => setConfirm(true)}>
        Delete…
      </Button>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Quick create: Lead">
        Mandatory fields only.
      </Drawer>
      <ConfirmDialog open={confirm} title="Delete 3 records?" text="This cannot be undone." destructive confirmLabel="Delete" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
    </div>
  );
}

export const Overlays: Story = { render: () => <OverlaysDemo /> };
