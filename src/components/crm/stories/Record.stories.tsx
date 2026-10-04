import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "../primitives";
import { DetailTabs, Field, FieldSection, FormSection, RecordHeader, RelatedListCard, RelatedNav, Required, StageProgressBar, StickyFormFooter, Timeline } from "../record";

const meta = { title: "CRM/Record detail & form", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const STAGES = ["Enquiry", "Test Drive", "Quotation", "Booking", "Finance / Payment", "Delivery", "Closed Won"].map((l) => ({ key: l, label: l }));

export const RecordDetailPage: Story = {
  render: () => (
    <div>
      <RecordHeader
        backHref="#"
        brand={{ code: "HMNL", name: "Hyundai", color: "#1d4ed8" }}
        moduleLabel="Deal"
        title="HMNL SUV – Acme Logistics"
        owner="Ada Okafor"
        meta={<StatusPill tone="primary">Quotation</StatusPill>}
        actions={
          <>
            <Button variant="outline">Send Email</Button>
            <Button>Edit</Button>
          </>
        }
      />
      <StageProgressBar stages={STAGES} current="Quotation" />
      <DetailTabs current="overview" tabs={[{ key: "overview", label: "Overview", href: "#" }, { key: "timeline", label: "Timeline", href: "#" }]} />
      <div className="flex items-start gap-4">
        <RelatedNav items={[{ id: "a", label: "Notes", count: 2 }, { id: "b", label: "Attachments" }, { id: "c", label: "Open Activities", count: 1 }]} />
        <div className="flex-1 space-y-3">
          <FieldSection title="Deal Information">
            <Field label="Deal name" value="HMNL SUV – Acme Logistics" />
            <Field label="Amount" value="₦ 32,500,000.00" />
            <Field label="Customer phone" value="0803****21" masked />
            <Field label="Closing date" value="31/10/2026" />
          </FieldSection>
          <RelatedListCard id="a" title="Notes" count={2} newHref="#">
            Customer prefers white colour.
          </RelatedListCard>
        </div>
      </div>
    </div>
  ),
};

export const LostStage: Story = { render: () => <StageProgressBar stages={[...STAGES.slice(0, 6), { key: "Closed Lost", label: "Closed Lost" }]} current="Closed Lost" lost /> };

export const TimelineFeed: Story = {
  render: () => (
    <Timeline
      entries={[
        { id: "1", at: "04/10/2026 10:12", who: "Ada Okafor", kind: "field", title: "Deal updated", details: [{ field: "stage", from: "Enquiry", to: "Quotation" }] },
        { id: "2", at: "03/10/2026 16:40", who: "System", kind: "system", title: "Deal created" },
      ]}
    />
  ),
};

export const RecordFormPage: Story = {
  render: () => (
    <form className="space-y-4">
      <FormSection title="Lead Information">
        <div className="space-y-1">
          <Label htmlFor="ln">
            Last name
            <Required />
          </Label>
          <Input id="ln" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fn">First name</Label>
          <Input id="fn" />
        </div>
      </FormSection>
      <StickyFormFooter cancelHref="#" saveAndNew={<Button variant="outline">Save and New</Button>}>
        <Button>Save</Button>
      </StickyFormFooter>
    </form>
  ),
};
