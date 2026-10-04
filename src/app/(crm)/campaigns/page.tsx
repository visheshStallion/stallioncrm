import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { EmptyState, PageTitleRow, StatusPill, type Tone } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { CAMPAIGN_TYPES, listCampaigns } from "@/server/modules/messaging/campaigns";
import { CHANNEL_LABELS } from "@/server/modules/messaging/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Campaigns" };
const TONE: Record<string, Tone> = { DRAFT: "neutral", SENDING: "warning", SENT: "success", CANCELLED: "danger" };

/** Campaigns of the viewer's brands (a campaign belongs to one brand). */
export default async function CampaignsPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "read")) forbidden();
  const [ui, dir, prefs] = await Promise.all([getUiFilters(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const campaigns = await listCampaigns(ctx, { brandId: ui.brandId });
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="Campaigns"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/campaigns/templates">Templates</Link>
            </Button>
            {hasPermission(ctx, "campaigns", "create") ? (
              <Button asChild>
                <Link href="/campaigns/new" data-shortcut="create">
                  Create Campaign
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No campaigns yet" text="A campaign sends one template to a brand's leads or customers who gave marketing consent for that brand." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="campaigns-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Members</th>
                <th className="px-3 py-2 text-right">Budget</th>
                <th className="px-3 py-2">Start</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    <div className="font-mono text-xs text-text-muted">{c.code}</div>
                  </td>
                  <td className="px-3 py-2">
                    <BrandBadge brand={dir.brands.find((b) => b.id === c.brandId)} />
                  </td>
                  <td className="px-3 py-2">{CAMPAIGN_TYPES[c.type]}</td>
                  <td className="px-3 py-2">{CHANNEL_LABELS[c.channel]}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={TONE[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c._count.members}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.budget === null ? "—" : formatMoney(Number(c.budget))}</td>
                  <td className="px-3 py-2">{formatDate(c.startDate, prefs.dateFormat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
