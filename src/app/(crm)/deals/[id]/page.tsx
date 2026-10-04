import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { OwnerPicker } from "@/components/crm/fields";
import { CustomFieldsSection } from "@/components/crm/CustomFieldsSection";
import { RecordNav } from "@/components/crm/KeyboardShortcuts";
import { ActivityPanel } from "@/components/crm/ActivityPanel";
import { MoveRecordCard, PendingApprovals } from "@/components/crm/RecordApprovals";
import { AttachmentsCard, NotesCard } from "@/components/crm/NotesAttachments";
import { StatusPill } from "@/components/crm/primitives";
import { DetailTabs, Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav, StageProgressBar, Timeline } from "@/components/crm/record";
import { stageTone } from "@/components/crm/tones";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { isManagerOf } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { releaseVinAction, reserveVinAction } from "@/server/modules/catalogue/actions";
import { listStock } from "@/server/modules/catalogue/queries";
import { changeDealOwnerAction } from "@/server/modules/deals/actions";
import { allowedTargets } from "@/server/modules/deals/blueprint";
import { dealFormLookups, dealStageHistory, dealTimeline, getDeal, getPipeline } from "@/server/modules/deals/queries";
import { recordActivities } from "@/server/modules/activities/queries";
import { pendingApprovalsFor } from "@/server/modules/approvals/service";
import { listCases } from "@/server/modules/cases/queries";
import { listAttachments, listNotes, mentionableUsers } from "@/server/modules/notes/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { CreateQuoteButton } from "../../_documents/DocActions";
import { DOCS } from "@/server/modules/documents/config";
import { dealDocuments } from "@/server/modules/documents/queries";
import { BlueprintButtons } from "../Blueprint";

const PAYMENT: Record<string, string> = { CASH: "Cash", BANK_FINANCE: "Bank finance", LEASE: "Lease", FLEET: "Fleet" };

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "read")) forbidden();
  // Missing and out-of-scope deals are both 404 – existence is never revealed.
  const deal = await getDeal(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const current = tab === "timeline" ? "timeline" : "overview";
  const [dir, prefs, pipeline, lookups, notes, attachments, users, stock, documents, activities, mentionable, approvals, cases] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    getPipeline(ctx, deal.pipelineId),
    dealFormLookups(ctx),
    listNotes(ctx, "Deal", id),
    listAttachments(ctx, "Deal", id),
    scopedDb(ctx).user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Vehicles reserved for this deal + available vehicles of the deal's brand (and model, when chosen).
    hasPermission(ctx, "products", "read")
      ? listStock(ctx, { OR: [{ dealId: id }, { brandId: deal.brandId, status: { in: ["IN_STOCK", "IN_TRANSIT"] }, ...(deal.modelId ? { productId: deal.modelId } : {}) }] })
      : Promise.resolve([]),
    dealDocuments(ctx, id),
    hasPermission(ctx, "activities", "read") ? recordActivities(ctx, "Deal", id) : { overdue: [], upcoming: [], history: [] },
    mentionableUsers(ctx, deal.brandId, deal.regionId),
    pendingApprovalsFor(ctx, "Deal", id),
    hasPermission(ctx, "cases", "read") ? listCases(ctx, { queue: "all", dealId: id }, {}, { take: 20 }).then((r) => r.rows) : [],
  ]);
  const reserved = stock.filter((s) => s.dealId === id);
  const available = stock.filter((s) => s.dealId !== id);
  const [history, fieldHistory] = current === "timeline" ? await Promise.all([dealStageHistory(ctx, id), dealTimeline(ctx, id)]) : [[], []];
  const brand = dir.brands.find((b) => b.id === deal.brandId);
  const region = dir.regions.find((r) => r.id === deal.regionId);
  const df = prefs.dateFormat;
  // Locked while an approval is pending (administrators excepted).
  const locked = approvals.length > 0 && !ctx.isAdmin;
  const mayEdit = can(ctx, "deals", "edit", deal) && brand?.status !== "INACTIVE";
  const canEdit = mayEdit && !locked;
  const manager = isManagerOf(ctx, deal.brandId, deal.regionId);
  const stages = pipeline?.stages ?? [];
  const from = stages.find((s) => s.id === deal.stageId);
  const lost = deal.stageType === "LOST";
  // Managers may jump to any stage; everyone else to previous / next / lost (or the stage's configured transitions).
  const targets = !from || !canEdit ? [] : manager ? stages.filter((s) => s.id !== from.id).map((s) => s.key) : allowedTargets(stages, from);

  const timeline = [
    ...history.map((h) => ({
      id: h.id,
      at: h.at,
      who: h.user,
      kind: "system" as const,
      title: h.from ? `Stage: ${h.from} → ${h.to}${h.durationHours !== null ? ` (after ${h.durationHours >= 48 ? `${Math.round(h.durationHours / 24)} days` : `${Math.round(h.durationHours)} h`})` : ""}` : `Entered ${h.to}`,
      details: undefined as Array<{ field: string; from: unknown; to: unknown }> | undefined,
    })),
    ...fieldHistory
      .filter((t) => t.action === "UPDATE" && t.details.some((d) => d.field !== "stageId"))
      .map((t) => ({ id: t.id, at: t.at, who: t.user, kind: "field" as const, title: "Fields updated", details: t.details.filter((d) => d.field !== "stageId") })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div>
      <RecordHeader
        backHref="/deals"
        brand={brand}
        moduleLabel="Deal"
        title={deal.name}
        owner={deal.ownerName}
        meta={
          <>
            <StatusPill tone={stageTone(deal.stageType)}>{deal.stageName}</StatusPill>
            {deal.stale ? (
              <StatusPill tone="warning">
                <span data-testid="stale-badge">Stale – {deal.daysInStage} days in stage</span>
              </StatusPill>
            ) : null}
          </>
        }
        nav={<RecordNav module="deals" id={deal.id} basePath="/deals" />}
        actions={
          <>
            {deal.stageType === "OPEN" && can(ctx, "quotes", "create", deal) && brand?.status !== "INACTIVE" ? <CreateQuoteButton dealId={deal.id} /> : null}
            {canEdit ? (
              <Button asChild>
                <Link href={`/deals/${deal.id}/edit`} data-shortcut="edit">
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <PendingApprovals approvals={approvals} dateFormat={df} />
      {pipeline && targets.length ? <BlueprintButtons deal={deal} pipeline={pipeline} targets={targets} products={lookups.products} /> : null}
      <StageProgressBar stages={stages.filter((s) => (lost ? s.type !== "WON" : s.type !== "LOST")).map((s) => ({ key: s.id, label: s.name }))} current={deal.stageId} lost={lost} />
      <DetailTabs
        current={current}
        tabs={[
          { key: "overview", label: "Overview", href: `/deals/${id}` },
          { key: "timeline", label: "Timeline", href: `/deals/${id}?tab=timeline` },
        ]}
      />
      {current === "timeline" ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <Timeline entries={timeline.map((t) => ({ ...t, at: formatDateTime(t.at, df) }))} />
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <RelatedNav
            items={[
              { id: "info", label: "Deal Information" },
              { id: "vehicle", label: "Vehicle & Payment" },
              { id: "delivery", label: "Booking & Delivery" },
              { id: "notes", label: "Notes", count: notes.length },
              { id: "attachments", label: "Attachments", count: attachments.length },
              { id: "open-activities", label: "Activities" },
              { id: "cases", label: "Cases", count: cases.length },
              { id: "quotes", label: "Quotes / Sales Orders" },
            ]}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <FieldSection title="Deal Information" id="info">
              <Field label="Deal name" value={deal.name} />
              <Field
                label="Account"
                value={
                  deal.accountId ? (
                    <Link href={`/accounts/${deal.accountId}`} className="text-primary hover:underline">
                      {deal.accountName}
                    </Link>
                  ) : (
                    deal.customerName
                  )
                }
              />
              <Field label="Amount" value={deal.currency === "NGN" ? formatMoney(deal.amount) : deal.amount === null ? null : `${deal.currency} ${deal.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} />
              <Field label="Expected close" value={formatDate(deal.closeDate, df)} />
              <Field label="Stage" value={`${deal.stageName} (${deal.probability}%)`} />
              <Field label="Brand" value={brand ? `${brand.code} – ${brand.name}` : null} />
              <Field label="Region" value={<RegionBadge region={region} />} />
              <Field label="Territory" value={deal.territoryName} />
            </FieldSection>
            <FieldSection title="Vehicle & Payment" id="vehicle">
              <Field label="Model" value={deal.modelName} />
              <Field label="Quantity" value={deal.quantity} />
              <Field label="Colour" value={deal.colour} />
              <Field label="Payment type" value={deal.paymentType ? PAYMENT[deal.paymentType] : null} />
              <Field label="Finance bank" value={deal.financeBank} />
              <Field label="Discount" value={deal.discountPct === null ? null : `${deal.discountPct}%`} />
              <Field label="Trade-in" value={deal.tradeInDetails} />
            </FieldSection>
            <FieldSection title="Booking & Delivery" id="delivery">
              <Field label="Test drive date" value={formatDate(deal.testDriveDate, df)} />
              <Field label="Deposit" value={formatMoney(deal.depositAmount)} />
              <Field label="Deposit receipt no." value={deal.depositReceiptNo} />
              <Field label="VIN / chassis no." value={deal.vinChassisNo} />
              <Field label="Engine no." value={deal.engineNo} />
              <Field label="Delivery date" value={formatDate(deal.deliveryDate, df)} />
              {lost ? <Field label="Loss reason" value={deal.lossReason} /> : null}
              {lost ? <Field label="Lost to" value={deal.lossCompetitorBrand} /> : null}
            </FieldSection>
            <CustomFieldsSection ctx={ctx} module="deals" id={deal.id} dateFormat={df} />
            {canEdit ? (
              <section className="rounded-lg border border-border bg-surface p-4">
                <h2 className="mb-1 text-[13px] font-semibold">Change owner</h2>
                <p className="mb-2 text-xs text-text-muted">The new owner must work in this deal&apos;s brand and region.</p>
                <ActionForm action={changeDealOwnerAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={deal.id} />
                  <div className="w-72">
                    <OwnerPicker name="ownerId" users={users} defaultValue={deal.ownerId} />
                  </div>
                  <SubmitButton size="sm" variant="outline">
                    Change owner
                  </SubmitButton>
                </ActionForm>
              </section>
            ) : null}
            {mayEdit && approvals.length === 0 && deal.stageType === "OPEN" ? (
              <MoveRecordCard
                entity="Deal"
                id={deal.id}
                brands={dir.brands.filter((b) => b.id !== deal.brandId && b.status === "ACTIVE").map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
                regions={dir.regions.filter((r) => r.id !== deal.regionId).map((r) => ({ id: r.id, label: r.name }))}
                users={users}
              />
            ) : null}
            <RelatedListCard id="vehicle-reservation" title="Vehicle reservation">
              {reserved.length ? (
                <ul className="mb-2 space-y-1" data-testid="reserved-vehicles">
                  {reserved.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="font-mono">{s.vin}</span>
                      <span className="text-text-muted">
                        {s.productName} · {s.colour ?? "—"} · {s.status === "SOLD" ? "Sold" : "Reserved"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-text-muted">No vehicle reserved. A reservation is released automatically when the deal is Closed Lost.</p>
              )}
              {canEdit && deal.stageType === "OPEN" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {available.length ? (
                    <ActionForm action={reserveVinAction} className="flex items-center gap-2">
                      <input type="hidden" name="dealId" value={deal.id} />
                      <Select name="stockId" required aria-label="Vehicle to reserve" className="w-80">
                        <option value="">Reserve a vehicle…</option>
                        {available.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.vin} – {s.productName} {s.colour ? `(${s.colour})` : ""}
                          </option>
                        ))}
                      </Select>
                      <SubmitButton size="sm" variant="outline">
                        Reserve
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <span className="text-text-muted">No vehicle available{deal.modelId ? " for this model" : ""}.</span>
                  )}
                  {reserved.some((s) => s.status === "RESERVED") ? (
                    <ActionForm action={releaseVinAction} confirm="Release the reserved vehicle?">
                      <input type="hidden" name="dealId" value={deal.id} />
                      <Button size="sm" variant="ghost" type="submit">
                        Release
                      </Button>
                    </ActionForm>
                  ) : null}
                </div>
              ) : null}
            </RelatedListCard>
            <NotesCard entity="Deal" entityId={deal.id} path={`/deals/${deal.id}`} notes={notes} canEdit={canEdit} dateFormat={df} mentionable={mentionable.filter((u) => u.id !== ctx.userId)} />
            <AttachmentsCard entity="Deal" entityId={deal.id} path={`/deals/${deal.id}`} attachments={attachments} canEdit={canEdit} dateFormat={df} />
            <ActivityPanel
              parentType="Deal"
              parentId={deal.id}
              groups={activities}
              canCreate={brand?.status !== "INACTIVE" && can(ctx, "activities", "create", deal)}
              canEdit={can(ctx, "activities", "edit", deal)}
              dateFormat={df}
              testDrive={deal.stageType === "OPEN"}
            />
            <RelatedListCard id="cases" title="Cases" count={cases.length} newHref={can(ctx, "cases", "create", deal) ? `/cases/new?dealId=${deal.id}` : undefined} empty="No cases for this deal.">
              {cases.length ? (
                <ul className="divide-y divide-border" data-testid="deal-cases">
                  {cases.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-1.5">
                      <Link href={`/cases/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.number}
                      </Link>
                      <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                      <StatusPill>{c.status.charAt(0) + c.status.slice(1).toLowerCase().replace(/_/g, " ")}</StatusPill>
                    </li>
                  ))}
                </ul>
              ) : undefined}
            </RelatedListCard>
            <RelatedListCard id="quotes" title="Quotes / Sales Orders / Invoices" count={documents.length} empty="No documents yet – use Create Quote. A sales order is created from an accepted quote, an invoice from a confirmed order.">
              {documents.length ? (
                <ul className="divide-y divide-border" data-testid="deal-documents">
                  {documents.map((d) => (
                    <li key={`${d.type}:${d.id}`} className="flex items-center gap-3 py-1.5">
                      <span className="w-24 text-xs text-text-muted">{DOCS[d.type].label}</span>
                      <Link href={`${DOCS[d.type].path}/${d.id}`} className="flex-1 font-medium text-primary hover:underline">
                        {d.number}
                      </Link>
                      <StatusPill>{DOCS[d.type].statuses[d.status]}</StatusPill>
                      <span className="w-36 text-right tabular-nums">{formatMoney(d.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : undefined}
            </RelatedListCard>
          </div>
        </div>
      )}
    </div>
  );
}
