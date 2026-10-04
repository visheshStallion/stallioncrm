import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandBadge } from "@/components/BrandBadge";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { ApprovalBanner, Avatar, AvatarStack, EmptyState, PageTitleRow, StatusPill } from "../primitives";

const meta = { title: "CRM/Primitives", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const StatusPills: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["neutral", "primary", "success", "warning", "danger", "info"] as const).map((t) => (
        <StatusPill key={t} tone={t}>
          {t}
        </StatusPill>
      ))}
    </div>
  ),
};

export const BrandAndRegionBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <BrandBadge brand={{ code: "HMNL", name: "Hyundai", color: "#1d4ed8" }} />
      <BrandBadge brand={{ code: "SNMNL", name: "Nissan", color: "#be123c" }} />
      <BrandBadge brand={{ code: "SMGL", color: "#047857" }} size="lg" />
      <RegionBadge region={{ name: "Lagos" }} />
    </div>
  ),
};

export const Avatars: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar name="Ada Okafor" />
      <Avatar name="Tobi Akande" size={36} />
      <AvatarStack names={["Ada Okafor", "Tobi Akande", "Segun Ajayi", "Zainab Ali", "Kunle Bakare"]} />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState title="No deals in this view" text="Try another view or clear the filters." actions={<Button size="sm">Create Deal</Button>} />
    </div>
  ),
};

export const TitleRowAndBanner: Story = {
  render: () => (
    <div className="space-y-3">
      <PageTitleRow title="Deals" actions={<Button>Create Deal</Button>} />
      <ApprovalBanner>Discount of 5% awaits approval by the HMNL Brand Manager.</ApprovalBanner>
    </div>
  ),
};
