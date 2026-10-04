import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { RecordNav } from "@/components/crm/KeyboardShortcuts";
import { StatusPill } from "@/components/crm/primitives";
import { DetailTabs, Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav, StageProgressBar, Timeline } from "@/components/crm/record";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { dealTimeline, getDeal } from "@/server/modules/deals/queries";
import { DEAL_STAGES, STAGE_LABELS } from "@/server/modules/deals/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { stageTone } from "@/components/crm/tones";

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "read")) forbidden();
  // Missing and out-of-scope deals are both 404 – existence is never revealed.
  const deal = await getDeal(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs] = await Promise.all([getDirectory(ctx), getPreferences(ctx)]);
  const brand = dir.brands.find((b) => b.id === deal.brandId);
  const region = dir.regions.find((r) => r.id === deal.regionId);
  const current = tab === "timeline" ? "timeline" : "overview";
  const timeline = current === "timeline" ? await dealTimeline(ctx, id) : [];
  const lost = deal.stage === "CLOSED_LOST";

  return (
    <div>
      <RecordHeader
        backHref="/deals"
        brand={brand}
        moduleLabel="Deal"
        title={deal.name}
        owner={deal.ownerName}
        meta={<StatusPill tone={stageTone(deal.stage)}>{STAGE_LABELS[deal.stage as keyof typeof STAGE_LABELS]}</StatusPill>}
        nav={<RecordNav module="deals" id={deal.id} basePath="/deals" />}
        actions={
          <>
            <Button variant="outline" disabled title="Email arrives with prompt 10">
              Send Email
            </Button>
            {can(ctx, "deals", "edit", deal) ? (
              <Button disabled title="Full deal editing arrives with the Blueprint (prompt 04)" data-shortcut="edit">
                Edit
              </Button>
            ) : null}
          </>
        }
      />
      <StageProgressBar
        stages={DEAL_STAGES.filter((s) => s !== (lost ? "CLOSED_WON" : "CLOSED_LOST")).map((s) => ({ key: s, label: STAGE_LABELS[s] }))}
        current={deal.stage}
        lost={lost}
      />
      <DetailTabs
        current={current}
        tabs={[
          { key: "overview", label: "Overview", href: `/deals/${id}` },
          { key: "timeline", label: "Timeline", href: `/deals/${id}?tab=timeline` },
        ]}
      />
      {current === "timeline" ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <Timeline
            entries={timeline.map((t) => ({
              id: t.id,
              at: formatDateTime(t.at, prefs.dateFormat),
              who: t.user,
              kind: "field",
              title: t.action === "CREATE" ? "Deal created" : t.action === "UPDATE" ? "Deal updated" : t.action,
              details: t.details,
            }))}
          />
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <RelatedNav
            items={[
              { id: "info", label: "Deal Information" },
              { id: "notes", label: "Notes" },
              { id: "attachments", label: "Attachments" },
              { id: "open-activities", label: "Open Activities" },
              { id: "closed-activities", label: "Closed Activities" },
              { id: "quotes", label: "Quotes / Sales Orders" },
              { id: "emails", label: "Emails" },
            ]}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <FieldSection title="Deal Information" id="info">
              <Field label="Deal name" value={deal.name} />
              <Field label="Customer" value={deal.customerName} />
              <Field label="Amount" value={formatMoney(deal.amount)} />
              <Field label="Closing date" value={formatDate(deal.closeDate, prefs.dateFormat)} />
              <Field label="Stage" value={STAGE_LABELS[deal.stage as keyof typeof STAGE_LABELS]} />
              <Field label="Owner" value={deal.ownerName} />
            </FieldSection>
            <FieldSection title="Brand & Territory">
              <Field label="Brand" value={brand ? `${brand.code} – ${brand.name}` : null} />
              <Field label="Region" value={<RegionBadge region={region} />} />
              <Field label="Territory" value={deal.territoryName} />
              <Field label="Modified" value={formatDateTime(deal.updatedAt, prefs.dateFormat)} />
            </FieldSection>
            <RelatedListCard id="notes" title="Notes" empty="Notes arrive with the Activities module." />
            <RelatedListCard id="attachments" title="Attachments" />
            <RelatedListCard id="open-activities" title="Open Activities" empty="No open activities." />
            <RelatedListCard id="closed-activities" title="Closed Activities" empty="No closed activities." />
            <RelatedListCard id="quotes" title="Quotes / Sales Orders" empty="Quotes arrive with prompt 06." />
            <RelatedListCard id="emails" title="Emails" empty="Emails arrive with prompt 10." />
            <p className="text-xs text-text-muted">
              <Link href="/deals" className="underline">
                Back to deals
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
