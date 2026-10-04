import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader } from "@/components/crm/record";
import { RegionBadge } from "@/components/RegionBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime, toLocalInput } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { completeActivityAction, rescheduleActivityAction } from "@/server/modules/activities/actions";
import { createCaseFromActivityAction } from "@/server/modules/cases/actions";
import { getActivity } from "@/server/modules/activities/queries";
import { RECURRENCE_OPTIONS } from "@/server/modules/activities/recurrence";
import { STATUS_LABELS, TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

const LOCATION: Record<string, string> = { SHOWROOM: "Showroom", HOME: "Customer's home / office", OTHER: "Other" };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "activities", "read")) forbidden();
  // Missing and out-of-scope activities are both 404.
  const a = await getActivity(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs] = await Promise.all([getDirectory(ctx), getPreferences(ctx)]);
  const brand = dir.brands.find((b) => b.id === a.brandId);
  const region = dir.regions.find((r) => r.id === a.regionId);
  const df = prefs.dateFormat;
  const canEdit = a.status === "OPEN" && can(ctx, "activities", "edit", a) && brand?.status !== "INACTIVE";
  const td = a.testDrive;
  const timed = a.type === "MEETING" || a.type === "TEST_DRIVE";

  return (
    <div>
      <RecordHeader
        backHref="/activities"
        brand={brand}
        moduleLabel={TYPE_LABELS[a.type as ActivityTypeKey]}
        title={a.subject}
        owner={a.ownerName}
        meta={
          a.overdue ? (
            <StatusPill tone="danger">Overdue</StatusPill>
          ) : (
            <StatusPill tone={a.status === "COMPLETED" ? "success" : a.status === "OPEN" ? "primary" : "neutral"}>{STATUS_LABELS[a.status as keyof typeof STATUS_LABELS]}</StatusPill>
          )
        }
        actions={
          a.phone ? (
            <a href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">
              Call {a.phone}
            </a>
          ) : null
        }
      />
      <div className="space-y-3">
        <FieldSection title="Activity Information" id="info">
          <Field label="Subject" value={a.subject} />
          <Field
            label="Related to"
            value={
              a.parentHref ? (
                <Link href={a.parentHref} className="text-primary hover:underline" data-testid="activity-parent">
                  Open {a.parentType.toLowerCase()}
                </Link>
              ) : (
                a.parentType
              )
            }
          />
          {timed ? <Field label="Start" value={formatDateTime(a.startAt, df)} /> : <Field label={a.type === "CALL" ? "Call time" : "Due"} value={formatDateTime(a.dueAt, df)} />}
          {timed ? <Field label="End" value={formatDateTime(a.endAt, df)} /> : null}
          <Field label="Priority" value={a.priority.charAt(0) + a.priority.slice(1).toLowerCase()} />
          <Field label="Region" value={<RegionBadge region={region} />} />
          {a.recurrence ? <Field label="Repeats" value={RECURRENCE_OPTIONS.find((o) => o.value === a.recurrence)?.label ?? a.recurrence} /> : null}
          {a.completedAt ? <Field label="Closed" value={formatDateTime(a.completedAt, df)} /> : null}
          {a.description ? <Field label="Description" value={<span className="whitespace-pre-wrap">{a.description}</span>} /> : null}
          {a.outcome ? <Field label="Outcome" value={<span className="whitespace-pre-wrap">{a.outcome}</span>} /> : null}
        </FieldSection>
        {a.type === "CALL" ? (
          <FieldSection title="Call Details" id="call">
            <Field label="Direction" value={a.direction ? a.direction.charAt(0) + a.direction.slice(1).toLowerCase() : null} />
            <Field label="Phone" value={a.phone} />
            <Field label="Duration" value={a.durationSec === null ? null : `${Math.floor(a.durationSec / 60)} min ${a.durationSec % 60} s`} />
            <Field label="Result" value={a.disposition ? a.disposition.replace(/_/g, " ").toLowerCase() : null} />
          </FieldSection>
        ) : null}
        {td ? (
          <FieldSection title="Demo Vehicle" id="test-drive">
            <Field label="Model" value={td.productName} />
            <Field label="VIN" value={td.vehicleVin ? <span className="font-mono">{td.vehicleVin}</span> : null} />
            <Field label="Plate" value={td.vehiclePlate} />
            <Field label="Location" value={LOCATION[td.location] ?? td.location} />
            <Field label="Licence checked" value={td.licenceChecked ? "Yes" : "No"} />
            <Field label="Licence number" value={td.licenceNumber} masked={!!td.licenceNumber?.startsWith("****")} />
            <Field label="Indemnity signed" value={td.indemnitySigned ? "Yes" : "No"} />
            <Field label="Odometer" value={td.odometerStart !== null || td.odometerEnd !== null ? `${td.odometerStart ?? "—"} → ${td.odometerEnd ?? "—"} km` : null} />
            <Field label="Feedback" value={td.feedbackRating ? `${td.feedbackRating} / 5` : null} />
            <Field label="Follow-up" value={td.followUpAt ? formatDateTime(td.followUpAt, df) : null} />
          </FieldSection>
        ) : null}
        {["WHATSAPP_LOG", "SMS_LOG", "EMAIL_LOG", "CALL"].includes(a.type) && (a.parentType === "Lead" || a.parentType === "Deal") && can(ctx, "cases", "create", a) ? (
          <section className="rounded-lg border border-border bg-surface p-4" id="to-case">
            <ActionForm action={createCaseFromActivityAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="activityId" value={a.id} />
              <span className="text-[13px]">Is this a complaint or a service request?</span>
              <SubmitButton size="sm" variant="outline">
                Create case from this {a.type === "CALL" ? "call" : "message"}
              </SubmitButton>
            </ActionForm>
          </section>
        ) : null}
        {canEdit ? (
          <section className="rounded-lg border border-border bg-surface p-4" id="complete">
            <h2 className="mb-2 text-[13px] font-semibold">{td ? "Complete test drive" : "Close activity"}</h2>
            <ActionForm action={completeActivityAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={a.id} />
              <div className="space-y-1">
                <Label htmlFor="status">Result</Label>
                <Select id="status" name="status" defaultValue="COMPLETED" className="w-full">
                  <option value="COMPLETED">Completed</option>
                  <option value="NO_SHOW">No-show</option>
                  <option value="CANCELLED">Cancelled</option>
                </Select>
              </div>
              {td ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="feedbackRating">Customer feedback (1–5)</Label>
                    <Input id="feedbackRating" name="feedbackRating" type="number" min={1} max={5} inputMode="numeric" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="odometerStart">Odometer start (km)</Label>
                    <Input id="odometerStart" name="odometerStart" type="number" min={0} inputMode="numeric" defaultValue={td.odometerStart ?? ""} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="odometerEnd">Odometer end (km)</Label>
                    <Input id="odometerEnd" name="odometerEnd" type="number" min={0} inputMode="numeric" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="followUpAt">Follow up on</Label>
                    <Input id="followUpAt" name="followUpAt" type="datetime-local" />
                  </div>
                </>
              ) : null}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="outcome">Outcome</Label>
                <textarea id="outcome" name="outcome" rows={2} maxLength={2000} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton size="sm">{td ? "Complete Test Drive" : "Close Activity"}</SubmitButton>
                {td && a.parentType === "Deal" ? <span className="ml-3 text-xs text-text-muted">A completed test drive moves the deal from Enquiry to Test Drive.</span> : null}
              </div>
            </ActionForm>
          </section>
        ) : null}
        {canEdit ? (
          <section className="rounded-lg border border-border bg-surface p-4" id="reschedule">
            <h2 className="mb-2 text-[13px] font-semibold">Reschedule</h2>
            <ActionForm action={rescheduleActivityAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={a.id} />
              {timed ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="startAt">Start</Label>
                    <Input id="startAt" name="startAt" type="datetime-local" required defaultValue={toLocalInput(a.startAt)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="endAt">End</Label>
                    <Input id="endAt" name="endAt" type="datetime-local" required defaultValue={toLocalInput(a.endAt)} />
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="dueAt">Due</Label>
                  <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={toLocalInput(a.dueAt)} />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="reminderAt">Reminder</Label>
                <Input id="reminderAt" name="reminderAt" type="datetime-local" />
              </div>
              <SubmitButton size="sm" variant="outline">
                Save
              </SubmitButton>
            </ActionForm>
          </section>
        ) : null}
      </div>
    </div>
  );
}
