import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { OwnerPicker } from "@/components/crm/fields";
import { RecordNav } from "@/components/crm/KeyboardShortcuts";
import { StatusPill } from "@/components/crm/primitives";
import { DetailTabs, Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav, Timeline } from "@/components/crm/record";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { fieldAccess } from "@/server/access/field-mask";
import { changeOwnerAction } from "@/server/modules/leads/actions";
import { getLead, leadFormLookups, leadTimeline } from "@/server/modules/leads/queries";
import { PAYMENT_LABELS, SOURCE_LABELS, STATUS_LABELS, WINDOW_LABELS } from "@/server/modules/leads/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { ratingTone, statusTone } from "@/components/crm/tones";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "read")) forbidden();
  // Missing and out-of-scope leads are both 404 – existence is never revealed.
  const lead = await getLead(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs, lookups] = await Promise.all([getDirectory(ctx), getPreferences(ctx), leadFormLookups(ctx)]);
  const current = tab === "timeline" ? "timeline" : "overview";
  const timeline = current === "timeline" ? await leadTimeline(ctx, id) : [];
  const brand = dir.brands.find((b) => b.id === lead.brandId);
  const region = dir.regions.find((r) => r.id === lead.regionId);
  const converted = lead.status === "CONVERTED";
  const canEdit = !converted && can(ctx, "leads", "edit", lead);
  const canConvert = canEdit && can(ctx, "deals", "create", lead);
  const level = (f: string) => fieldAccess(ctx, "leads", f);
  const df = prefs.dateFormat;

  return (
    <div>
      <RecordHeader
        backHref="/leads"
        brand={brand}
        moduleLabel="Lead"
        title={lead.name}
        owner={lead.ownerName}
        meta={
          <>
            <StatusPill tone={statusTone(lead.status)}>{STATUS_LABELS[lead.status as keyof typeof STATUS_LABELS]}</StatusPill>
            {lead.rating ? <StatusPill tone={ratingTone(lead.rating)}>{lead.rating}</StatusPill> : null}
          </>
        }
        nav={<RecordNav module="leads" id={lead.id} basePath="/leads" />}
        actions={
          <>
            {lead.email ? (
              <Button asChild variant="outline">
                <a href={`mailto:${lead.email}`}>Send Email</a>
              </Button>
            ) : null}
            {canConvert ? (
              <Button asChild variant="outline">
                <Link href={`/leads/${lead.id}/convert`}>Convert</Link>
              </Button>
            ) : null}
            {converted && lead.convertedDealId ? (
              <Button asChild variant="outline">
                <Link href={`/deals/${lead.convertedDealId}`}>Open deal</Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button asChild>
                <Link href={`/leads/${lead.id}/edit`} data-shortcut="edit">
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DetailTabs
        current={current}
        tabs={[
          { key: "overview", label: "Overview", href: `/leads/${id}` },
          { key: "timeline", label: "Timeline", href: `/leads/${id}?tab=timeline` },
        ]}
      />
      {current === "timeline" ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <Timeline
            entries={timeline.map((t) => ({
              id: t.id,
              at: formatDateTime(t.at, df),
              who: t.user,
              kind: "field",
              title: t.action === "CREATE" ? "Lead created" : t.action === "UPDATE" ? "Lead updated" : t.action,
              details: t.changes,
            }))}
          />
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <RelatedNav
            items={[
              { id: "info", label: "Lead Information" },
              { id: "vehicle", label: "Vehicle & Payment" },
              { id: "notes", label: "Notes" },
              { id: "attachments", label: "Attachments" },
              { id: "open-activities", label: "Open Activities" },
              { id: "emails", label: "Emails" },
            ]}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <FieldSection title="Lead Information" id="info">
              <Field label="First name" value={lead.firstName} />
              <Field label="Last name" value={lead.lastName} />
              <Field label="Mobile" value={lead.mobile} masked={level("mobile") === "masked"} hidden={level("mobile") === "hidden"} />
              <Field label="Email" value={lead.email} masked={level("email") === "masked"} hidden={level("email") === "hidden"} />
              <Field label="City" value={lead.city} />
              <Field label="Region" value={<RegionBadge region={region} />} />
              <Field label="Lead source" value={`${SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ""}`} />
              <Field label="Created" value={formatDateTime(lead.createdAt, df)} />
              {lead.utm ? <Field label="Campaign (UTM)" value={Object.entries(lead.utm).map(([k, v]) => `${k}=${v}`).join(" · ")} /> : null}
              {lead.unqualifiedReason ? <Field label="Unqualified reason" value={lead.unqualifiedReason} /> : null}
            </FieldSection>
            <FieldSection title="Vehicle & Payment" id="vehicle">
              <Field label="Model of interest" value={lead.modelName} />
              <Field label="Budget" value={formatMoney(lead.budget)} masked={level("budget") === "masked"} hidden={level("budget") === "hidden"} />
              <Field label="Payment intent" value={lead.paymentIntent ? PAYMENT_LABELS[lead.paymentIntent as keyof typeof PAYMENT_LABELS] : null} />
              <Field label="Expected purchase" value={lead.expectedPurchaseWindow ? WINDOW_LABELS[lead.expectedPurchaseWindow as keyof typeof WINDOW_LABELS] : null} />
              <Field label="Trade-in" value={lead.tradeIn ? `Yes${lead.tradeInNotes ? ` – ${lead.tradeInNotes}` : ""}` : "No"} />
              <Field label="Marketing consent" value={lead.consentMarketing ? `Yes (${formatDate(lead.consentAt, df)})` : "No"} />
            </FieldSection>
            {canEdit ? (
              <section className="rounded-lg border border-border bg-surface p-4">
                <h2 className="mb-2 text-[13px] font-semibold">Change owner</h2>
                <p className="mb-2 text-xs text-text-muted">The new owner must work in this lead&apos;s brand and region.</p>
                <ActionForm action={changeOwnerAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={lead.id} />
                  <div className="w-72">
                    <OwnerPicker name="ownerId" users={lookups.users} defaultValue={lead.ownerId} />
                  </div>
                  <SubmitButton size="sm" variant="outline">
                    Change owner
                  </SubmitButton>
                </ActionForm>
              </section>
            ) : null}
            <RelatedListCard id="notes" title="Notes" empty="Notes arrive with the Activities module." />
            <RelatedListCard id="attachments" title="Attachments" />
            <RelatedListCard id="open-activities" title="Open Activities" empty="No open activities." />
            <RelatedListCard id="emails" title="Emails" empty="Emails arrive with prompt 10." />
          </div>
        </div>
      )}
    </div>
  );
}
