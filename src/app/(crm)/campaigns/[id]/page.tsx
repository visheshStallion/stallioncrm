import type { MemberStatus } from "@prisma/client";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Pagination } from "@/components/crm/ListPage";
import { StatusPill, type Tone } from "@/components/crm/primitives";
import { RecordHeader } from "@/components/crm/record";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { parsePaging } from "@/server/list/filters";
import { buildAudienceAction, cancelCampaignAction, launchCampaignAction, saveCampaignAction } from "@/server/modules/messaging/actions";
import { CAMPAIGN_TYPES, campaignMembers, campaignStats, getCampaign, MEMBER_LABELS, templatesFor } from "@/server/modules/messaging/campaigns";
import { CHANNEL_LABELS } from "@/server/modules/messaging/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { listReports } from "@/server/modules/reports/service";
import { requireContext } from "@/server/request";
import { CampaignFields } from "../CampaignFields";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { getSetting } from "@/server/modules/setup/service";

const TONE: Record<string, Tone> = { DRAFT: "neutral", SENDING: "warning", SENT: "success", CANCELLED: "danger" };
const MEMBER_TONE: Partial<Record<MemberStatus, Tone>> = { SENT: "primary", DELIVERED: "info", OPENED: "success", CLICKED: "success", RESPONDED: "success", UNSUBSCRIBED: "warning", FAILED: "danger", SUPPRESSED: "neutral" };
const STATUSES = Object.keys(MEMBER_LABELS) as MemberStatus[];
const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string; per?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "read")) forbidden();
  // Campaigns of other brands are a 404.
  const campaign = await getCampaign(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const status = STATUSES.includes(sp.status as MemberStatus) ? (sp.status as MemberStatus) : undefined;
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "25" });
  const [dir, prefs, stats, members, templates, reports] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    campaignStats(ctx, id),
    campaignMembers(ctx, id, { status, take: paging.per, skip: paging.skip }),
    templatesFor(ctx, campaign.brandId, campaign.channel),
    hasPermission(ctx, "reports", "read") ? listReports(ctx) : [],
  ]);
  const brand = dir.brands.find((b) => b.id === campaign.brandId);
  const draft = campaign.status === "DRAFT";
  const canEdit = hasPermission(ctx, "campaigns", "edit");
  const canSend = hasPermission(ctx, "campaigns", "massEmail");
  const audience = (campaign.audience ?? {}) as { kind?: string; reportId?: string | null };
  const n = (s: MemberStatus) => stats.members[s] ?? 0;
  const chip = "rounded-full border px-2.5 py-0.5 text-xs";

  return (
    <div className="mx-auto max-w-6xl">
      <RecordHeader
        backHref="/campaigns"
        brand={brand}
        moduleLabel="Campaign"
        title={campaign.name}
        meta={
          <>
            <StatusPill tone={TONE[campaign.status]}>{campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}</StatusPill>
            <span className="text-xs text-text-muted">
              {CAMPAIGN_TYPES[campaign.type]} · {CHANNEL_LABELS[campaign.channel]} · code <span className="font-mono">{campaign.code}</span>
            </span>
          </>
        }
        actions={
          <>
            {draft && canSend ? (
              <ActionForm action={launchCampaignAction} confirm={`Send this campaign to ${n("PENDING")} people as ${brand?.code}?`}>
                <input type="hidden" name="id" value={id} />
                <SubmitButton>Launch</SubmitButton>
              </ActionForm>
            ) : null}
            {(draft || campaign.status === "SENDING") && canEdit ? (
              <ActionForm action={cancelCampaignAction} confirm="Cancel this campaign?">
                <input type="hidden" name="id" value={id} />
                <SubmitButton variant="outline">Cancel campaign</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />
      {draft && !canSend ? <p className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-[13px]">Launching a campaign needs the mass email permission (Brand Manager and above).</p> : null}

      <dl className="mb-4 grid gap-x-6 gap-y-1 rounded-lg border border-border bg-surface p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4" data-testid="campaign-info">
        {(
          [
            ["Status", campaign.planStatus],
            ["Start Date", d(campaign.startDate)],
            ["End Date", d(campaign.endDate)],
            ["Currency", campaign.currency === "NGN" ? "NGN" : `${campaign.currency} · ₦ ${Number(campaign.exchangeRate)}`],
            ["Expected Revenue", campaign.expectedRevenue === null ? null : formatMoney(Number(campaign.expectedRevenue))],
            ["Budgeted Cost", campaign.budget === null ? null : formatMoney(Number(campaign.budget))],
            ["Actual Cost", campaign.actualCost === null ? null : formatMoney(Number(campaign.actualCost))],
            ["Expected Response", campaign.expectedResponse],
            ["Numbers sent", campaign.numbersSent],
            ["Description", campaign.description],
          ] as Array<[string, string | number | null]>
        ).map(([label, value]) => (
          <div key={label} className={label === "Description" ? "sm:col-span-2 lg:col-span-4" : undefined}>
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd data-field={label} className="whitespace-pre-wrap">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="campaign-stats">
        {[
          ["Audience", stats.total, `${n("PENDING")} pending · ${n("SUPPRESSED")} suppressed`],
          ["Reached", stats.reached, `${n("DELIVERED") + n("OPENED") + n("CLICKED") + n("RESPONDED")} delivered · ${n("FAILED")} failed`],
          ["Responded", n("RESPONDED"), `${n("OPENED") + n("CLICKED")} opened · ${n("UNSUBSCRIBED")} unsubscribed`],
          ["Leads / deals", `${stats.leads} / ${stats.deals}`, `${stats.wonDeals} won`],
          ["Won revenue", formatMoney(stats.revenue), stats.roi === null ? (stats.budget === null ? "no budget set" : "") : `ROI ${stats.roi}% on ${formatMoney(stats.budget)}`],
        ].map(([label, value, sub]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[11px] font-semibold uppercase text-text-muted">{label}</div>
            <div className="text-[18px] font-semibold">{value}</div>
            <div className="text-xs text-text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {draft && canEdit ? (
        <ActionForm action={saveCampaignAction} className="mb-4 space-y-3">
          <input type="hidden" name="id" value={id} />
          <CampaignFields
            values={{ id, brandId: campaign.brandId, name: campaign.name, type: campaign.type, channel: campaign.channel, budget: campaign.budget === null ? null : Number(campaign.budget), startDate: d(campaign.startDate), endDate: d(campaign.endDate), templateId: campaign.templateId, audienceKind: audience.kind, reportId: audience.reportId, ownerId: campaign.ownerId, planStatus: campaign.planStatus, expectedRevenue: campaign.expectedRevenue === null ? null : Number(campaign.expectedRevenue), actualCost: campaign.actualCost === null ? null : Number(campaign.actualCost), expectedResponse: campaign.expectedResponse, numbersSent: campaign.numbersSent, currency: campaign.currency, description: campaign.description }}
            owners={(await productFormLookups(ctx, [campaign.brandId])).owners}
            rates={{ NGN: 1, ...(((await getSetting("currencies")) as { rates?: Record<string, number> }).rates ?? {}) }}
            brands={dir.brands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
            templates={templates.map((t) => ({ id: t.id, label: `${t.name}${campaign.channel === "WHATSAPP" ? ` (${t.whatsappStatus.toLowerCase().replace("_", " ")})` : ""}` }))}
            reports={reports.filter((r) => !r.definition.special && (r.module === "leads" || r.module === "deals")).map((r) => ({ id: r.id, label: r.name }))}
          />
          <div className="flex justify-end">
            <SubmitButton variant="outline">Save changes</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-surface p-4 text-[13px]">
          <h2 className="mb-1 font-semibold">Message</h2>
          <p className="text-text-muted">Template: {campaign.template?.name ?? "—"}</p>
          {campaign.template ? <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted p-2">{campaign.template.body}</p> : null}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Members</h2>
          <Link href={`/campaigns/${id}`} className={cn(chip, !status ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
            All {stats.total}
          </Link>
          {STATUSES.filter((s) => n(s) > 0).map((s) => (
            <Link key={s} href={`/campaigns/${id}?status=${s}`} className={cn(chip, status === s ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              {MEMBER_LABELS[s]} {n(s)}
            </Link>
          ))}
          {draft && canEdit ? (
            <ActionForm action={buildAudienceAction} className="ml-auto">
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" variant="outline">
                {stats.total ? "Rebuild audience" : "Build audience"}
              </SubmitButton>
            </ActionForm>
          ) : null}
        </header>
        {members.rows.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">{stats.total ? "No members with this status." : "Build the audience to see who will receive the campaign – and who is suppressed because they did not consent to this brand."}</p>
        ) : (
          <table className="w-full text-[13px]" data-testid="campaign-members">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Sent</th>
              </tr>
            </thead>
            <tbody>
              {members.rows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    {m.leadId ? (
                      <Link href={`/leads/${m.leadId}`} className="text-primary hover:underline">
                        {m.name}
                      </Link>
                    ) : m.dealId ? (
                      <Link href={`/deals/${m.dealId}`} className="text-primary hover:underline">
                        {m.name}
                      </Link>
                    ) : (
                      m.name
                    )}
                  </td>
                  <td className="px-3 py-2">{m.address}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={MEMBER_TONE[m.status] ?? "neutral"}>{MEMBER_LABELS[m.status]}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{m.reason}</td>
                  <td className="px-3 py-2">{m.sentAt ? formatDateTime(m.sentAt, prefs.dateFormat) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Pagination total={members.total} page={paging.page} per={paging.per} />
      <p className="mt-3 flex items-center gap-2 text-xs text-text-muted">
        <BrandBadge brand={brand} /> Messages are sent as {brand?.name}. Leads from the web form are attributed with <span className="font-mono">utm_campaign={campaign.code}</span>.
      </p>
    </div>
  );
}
