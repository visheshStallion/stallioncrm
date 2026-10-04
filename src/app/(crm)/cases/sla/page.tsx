import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { addHolidayAction, removeHolidayAction, saveBusinessHoursAction, saveSlaAction } from "@/server/modules/cases/actions";
import { canManageSla, getCalendarSettings, listSlaPolicies } from "@/server/modules/cases/admin";
import { PRIORITY_LABELS } from "@/server/modules/cases/schema";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "SLA & business calendar" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * SLA policies per brand and priority (edited by the brand's manager) and the group's business calendar
 * (working days, hours, public holidays – administrators). SLA timers only run inside business hours.
 */
export default async function SlaPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "cases", "read")) forbidden();
  const [policies, calendar, roles, prefs] = await Promise.all([listSlaPolicies(ctx), getCalendarSettings(ctx), scopedDb(ctx).role.findMany({ select: { name: true }, orderBy: { name: "asc" } }), getPreferences(ctx)]);
  const brands = [...new Map(policies.map((p) => [p.brandId, p.brand])).entries()];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="SLA & business calendar"
        left={
          <Link href="/cases" className="text-sm text-primary hover:underline">
            ← Cases
          </Link>
        }
      />
      <div className="space-y-4">
        {brands.map(([brandId, brand]) => {
          const editable = canManageSla(ctx, brandId);
          return (
            <section key={brandId} className="rounded-lg border border-border bg-surface" data-testid={`sla-${brand.code}`}>
              <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">
                {brand.code} – {brand.name}
              </h2>
              <ul className="divide-y divide-border">
                {policies
                  .filter((p) => p.brandId === brandId)
                  .map((p) => (
                    <li key={p.id} className="px-4 py-2">
                      <ActionForm action={saveSlaAction} className="flex flex-wrap items-end gap-3 text-[13px]">
                        <input type="hidden" name="brandId" value={brandId} />
                        <input type="hidden" name="priority" value={p.priority} />
                        <span className="w-20 pb-2 font-semibold">{PRIORITY_LABELS[p.priority]}</span>
                        <div className="space-y-1">
                          <Label htmlFor={`fr-${p.id}`}>First response (hours)</Label>
                          <Input id={`fr-${p.id}`} name="firstResponseHours" type="number" min={1} max={720} defaultValue={p.firstResponseHours} disabled={!editable} className="w-32" />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`rs-${p.id}`}>Resolution (hours)</Label>
                          <Input id={`rs-${p.id}`} name="resolutionHours" type="number" min={1} max={2160} defaultValue={p.resolutionHours} disabled={!editable} className="w-32" />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`role-${p.id}`}>Escalate to</Label>
                          <Select id={`role-${p.id}`} name="escalateToRole" defaultValue={p.escalateToRole} disabled={!editable}>
                            {roles.map((r) => (
                              <option key={r.name} value={r.name}>
                                {r.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {editable ? (
                          <SubmitButton size="sm" variant="outline">
                            Save
                          </SubmitButton>
                        ) : null}
                      </ActionForm>
                    </li>
                  ))}
              </ul>
            </section>
          );
        })}

        <section className="rounded-lg border border-border bg-surface p-4" data-testid="business-calendar">
          <h2 className="mb-1 text-[13px] font-semibold">Business calendar (Africa/Lagos)</h2>
          <p className="mb-3 text-xs text-text-muted">SLA time runs only on working days within these hours and never on a public holiday.</p>
          <ActionForm action={saveBusinessHoursAction} className="flex flex-wrap items-end gap-4">
            <fieldset className="flex flex-wrap gap-3 text-sm" disabled={!ctx.isAdmin}>
              <legend className="mb-1 text-[13px] font-medium">Working days</legend>
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="workDays" value={i + 1} defaultChecked={calendar.workDays.includes(i + 1)} /> {d}
                </label>
              ))}
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="opensAt">Opens</Label>
              <Input id="opensAt" name="opensAt" type="time" defaultValue={calendar.opensAt} disabled={!ctx.isAdmin} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="closesAt">Closes</Label>
              <Input id="closesAt" name="closesAt" type="time" defaultValue={calendar.closesAt} disabled={!ctx.isAdmin} />
            </div>
            {ctx.isAdmin ? (
              <SubmitButton size="sm" variant="outline">
                Save hours
              </SubmitButton>
            ) : null}
          </ActionForm>
          <h3 className="mb-1 mt-4 text-[13px] font-semibold">Public holidays</h3>
          <ul className="grid gap-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3" data-testid="holidays">
            {calendar.holidays
              .filter((h) => h.date >= today)
              .map((h) => (
                <li key={h.date} className="flex items-center gap-2 rounded border border-border px-2 py-1">
                  <span className="tabular-nums">{formatDate(h.date, prefs.dateFormat, "UTC")}</span>
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  {ctx.isAdmin ? (
                    <ActionForm action={removeHolidayAction}>
                      <input type="hidden" name="date" value={h.date} />
                      <button type="submit" className="text-xs text-text-muted underline" aria-label={`Remove ${h.name} ${h.date}`}>
                        remove
                      </button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
          </ul>
          {ctx.isAdmin ? (
            <ActionForm action={addHolidayAction} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="h-date">Date</Label>
                <Input id="h-date" name="date" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="h-name">Holiday (e.g. Eid, Easter Monday)</Label>
                <Input id="h-name" name="name" required maxLength={100} className="w-64" />
              </div>
              <SubmitButton size="sm" variant="outline">
                Add holiday
              </SubmitButton>
            </ActionForm>
          ) : null}
        </section>
      </div>
    </div>
  );
}
