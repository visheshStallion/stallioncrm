import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ActivityPanel } from "@/components/crm/ActivityPanel";
import { CustomFieldsSection } from "@/components/crm/CustomFieldsSection";
import { AttachmentsCard, NotesCard } from "@/components/crm/NotesAttachments";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav } from "@/components/crm/record";
import { RegionBadge } from "@/components/RegionBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { fieldMaskView } from "@/server/access/field-mask";
import { isManagerOf } from "@/server/access/visibility";
import { recordActivities, usersWhoCanSee } from "@/server/modules/activities/queries";
import { assignCaseAction, changeCaseStatusAction, updateCaseAction } from "@/server/modules/cases/actions";
import { suggestSolutions } from "@/server/modules/cases/admin";
import { getCase } from "@/server/modules/cases/queries";
import { CASE_PRIORITIES, CASE_STATUSES, CASE_TYPES, CHANNEL_LABELS, PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/server/modules/cases/schema";
import { listAttachments, listNotes, mentionableUsers } from "@/server/modules/notes/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { SLA_LABEL, SLA_TONE, STATUS_TONE } from "../tones";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "cases", "read")) forbidden();
  // Missing and out-of-scope cases are both 404 – existence is never revealed.
  const c = fieldMaskView(
    ctx,
    "cases",
    await getCase(ctx, id).catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    }),
  );
  const [dir, prefs, notes, attachments, activities, mentionable, colleagues, solutions] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    listNotes(ctx, "Case", c.id),
    listAttachments(ctx, "Case", c.id),
    hasPermission(ctx, "activities", "read") ? recordActivities(ctx, "Case", c.id) : { overdue: [], upcoming: [], history: [] },
    mentionableUsers(ctx, c.brandId, c.regionId),
    usersWhoCanSee(ctx, c.brandId, c.regionId),
    suggestSolutions(ctx, c),
  ]);
  const brand = dir.brands.find((b) => b.id === c.brandId);
  const region = dir.regions.find((r) => r.id === c.regionId);
  const df = prefs.dateFormat;
  const canEdit = can(ctx, "cases", "edit", c) && brand?.status !== "INACTIVE";
  const manager = isManagerOf(ctx, c.brandId, c.regionId);
  const canReassign = canEdit && (manager || c.ownerId === ctx.userId);
  const customer = c.contactName ?? c.accountName ?? c.customerName;
  const base = `/cases/${c.id}`;

  return (
    <div>
      <RecordHeader
        backHref="/cases"
        brand={brand}
        moduleLabel="Case"
        title={`${c.number} – ${c.subject}`}
        owner={c.unassigned ? "Unassigned" : c.ownerName}
        meta={
          <>
            <StatusPill tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status as keyof typeof STATUS_LABELS]}</StatusPill>
            <StatusPill tone={SLA_TONE[c.sla]}>
              <span data-testid="sla-state">SLA: {SLA_LABEL[c.sla]}</span>
            </StatusPill>
            <StatusPill>{PRIORITY_LABELS[c.priority as keyof typeof PRIORITY_LABELS]}</StatusPill>
          </>
        }
        actions={
          canEdit && (c.unassigned || (c.ownerId !== ctx.userId && c.open)) ? (
            <ActionForm action={assignCaseAction}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="outline">Take case</SubmitButton>
            </ActionForm>
          ) : null
        }
      />
      <div className="flex items-start gap-4">
        <RelatedNav
          items={[
            { id: "info", label: "Case Information" },
            { id: "sla", label: "SLA" },
            { id: "work", label: "Status & Resolution" },
            { id: "notes", label: "Notes", count: notes.length },
            { id: "attachments", label: "Attachments", count: attachments.length },
            { id: "open-activities", label: "Activities" },
            { id: "solutions", label: "Solutions", count: solutions.length },
          ]}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <FieldSection title="Case Information" id="info">
            <Field label="Subject" value={c.subject} />
            <Field label="Type" value={TYPE_LABELS[c.type as keyof typeof TYPE_LABELS]} />
            <Field label="Channel" value={CHANNEL_LABELS[c.channel as keyof typeof CHANNEL_LABELS]} />
            <Field label="Brand" value={brand ? `${brand.code} – ${brand.name}` : null} />
            <Field label="Region" value={<RegionBadge region={region} />} />
            <Field label="Customer" value={customer} />
            <Field
              label="Account"
              value={
                c.accountId ? (
                  <Link href={`/accounts/${c.accountId}`} className="text-primary hover:underline">
                    {c.accountName}
                  </Link>
                ) : null
              }
            />
            <Field
              label="Deal"
              value={
                c.dealId ? (
                  <Link href={`/deals/${c.dealId}`} className="text-primary hover:underline">
                    {c.dealName}
                  </Link>
                ) : null
              }
            />
            <Field label="VIN" value={c.vin ? <span className="font-mono">{c.vin}</span> : null} />
            <Field label="Customer phone" value={c.customerPhone} />
            <Field label="Customer email" value={c.customerEmail} />
            <Field label="Created" value={formatDateTime(c.createdAt, df)} />
            {c.description ? <Field label="Description" value={<span className="whitespace-pre-wrap">{c.description}</span>} /> : null}
          </FieldSection>
          <FieldSection title="SLA (business hours)" id="sla">
            <Field label="First response due" value={c.firstResponseDueAt ? `${formatDateTime(c.firstResponseDueAt, df)} – ${SLA_LABEL[c.firstResponse]}` : null} />
            <Field label="First response" value={c.firstRespondedAt ? formatDateTime(c.firstRespondedAt, df) : null} />
            <Field label="Resolution due" value={c.slaDueAt ? `${formatDateTime(c.slaDueAt, df)} – ${SLA_LABEL[c.sla]}` : null} />
            <Field label="Resolved" value={c.resolvedAt ? formatDateTime(c.resolvedAt, df) : null} />
            <Field label="Escalated" value={c.escalatedAt ? formatDateTime(c.escalatedAt, df) : null} />
            <Field label="Closed" value={c.closedAt ? formatDateTime(c.closedAt, df) : null} />
            {c.resolution ? <Field label="Resolution" value={<span className="whitespace-pre-wrap">{c.resolution}</span>} /> : null}
            <Field label="Satisfaction" value={c.satisfactionScore ? `${c.satisfactionScore} / 5${c.satisfactionNote ? ` – “${c.satisfactionNote}”` : ""}` : c.surveySentAt ? "Survey sent, no answer yet" : null} />
          </FieldSection>
          <CustomFieldsSection ctx={ctx} module="cases" id={c.id} dateFormat={df} />
          {canEdit ? (
            <section className="rounded-lg border border-border bg-surface p-4" id="work">
              <h2 className="mb-2 text-[13px] font-semibold">Status &amp; Resolution</h2>
              <ActionForm action={changeCaseStatusAction} className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
                <input type="hidden" name="id" value={c.id} />
                <div className="space-y-1">
                  <Label htmlFor="status">Status</Label>
                  <Select id="status" name="status" defaultValue={c.status} className="w-full">
                    {CASE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="resolution">Resolution (required to resolve or close)</Label>
                  <Input id="resolution" name="resolution" maxLength={4000} defaultValue={c.resolution ?? ""} />
                </div>
                <SubmitButton size="sm">Update status</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-text-muted">Closing a case sends the customer a satisfaction survey as {brand?.name}.</p>
              <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                <ActionForm action={updateCaseAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="space-y-1">
                    <Label htmlFor="type">Type</Label>
                    <Select id="type" name="type" defaultValue={c.type}>
                      {CASE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="priority">Priority</Label>
                    <Select id="priority" name="priority" defaultValue={c.priority}>
                      {CASE_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <SubmitButton size="sm" variant="outline">
                    Save
                  </SubmitButton>
                </ActionForm>
                {canReassign ? (
                  <ActionForm action={assignCaseAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="space-y-1">
                      <Label htmlFor="ownerId">Reassign to (same brand and region)</Label>
                      <Select id="ownerId" name="ownerId" required defaultValue="" className="w-64">
                        <option value="">Choose colleague…</option>
                        {colleagues
                          .filter((u) => u.id !== c.ownerId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <SubmitButton size="sm" variant="outline">
                      Reassign
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </section>
          ) : null}
          <NotesCard entity="Case" entityId={c.id} path={base} notes={notes} canEdit={canEdit} dateFormat={df} mentionable={mentionable.filter((u) => u.id !== ctx.userId)} />
          <AttachmentsCard entity="Case" entityId={c.id} path={base} attachments={attachments} canEdit={canEdit} dateFormat={df} />
          <ActivityPanel parentType="Case" parentId={c.id} groups={activities} canCreate={canEdit && can(ctx, "activities", "create", c)} canEdit={can(ctx, "activities", "edit", c)} dateFormat={df} phone={c.customerPhone} />
          <RelatedListCard id="solutions" title="Suggested solutions" count={solutions.length} empty="No matching knowledge articles.">
            {solutions.length ? (
              <ul className="space-y-1">
                {solutions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/cases/solutions?id=${s.id}`} className="text-primary hover:underline">
                      {s.title}
                    </Link>
                    <span className="ml-2 text-xs text-text-muted">{s.brandId ? brand?.code : "Group"}</span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </RelatedListCard>
        </div>
      </div>
    </div>
  );
}
