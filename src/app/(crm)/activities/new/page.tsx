import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { MultiPicklist } from "@/components/crm/fields";
import { PageTitleRow } from "@/components/crm/primitives";
import { FormSection, Required, StickyFormFooter } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { createActivityAction } from "@/server/modules/activities/actions";
import { usersWhoCanSee } from "@/server/modules/activities/queries";
import { RECURRENCE_OPTIONS } from "@/server/modules/activities/recurrence";
import { CALL_DISPOSITIONS } from "@/server/modules/activities/schema";
import { leadFormLookups, leadName } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "New Activity" };

const TYPES = [
  { key: "task", type: "TASK", label: "Task" },
  { key: "call", type: "CALL", label: "Call" },
  { key: "meeting", type: "MEETING", label: "Meeting" },
  { key: "testdrive", type: "TEST_DRIVE", label: "Test Drive" },
] as const;
const PATHS: Record<string, string> = { Lead: "/leads", Deal: "/deals", Account: "/accounts" };
const DISPOSITION_LABELS: Record<string, string> = { CONNECTED: "Connected", NO_ANSWER: "No answer", BUSY: "Busy", WRONG_NUMBER: "Wrong number", LEFT_MESSAGE: "Left message" };

function F({ label, id, required, children, hint, wide }: { label: string; id: string; required?: boolean; children: React.ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={cn("space-y-1", wide && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {label}
        {required ? <Required /> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

type SP = { type?: string; parentType?: string; parentId?: string; log?: string; phone?: string; date?: string };

/** Create a task / meeting, log a call or book a test drive. Brand and region come from the related record. */
export default async function NewActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "activities", "create")) forbidden();
  const def = TYPES.find((t) => t.key === sp.type) ?? TYPES[0];
  const db = scopedDb(ctx);
  const isLog = def.type === "CALL" && sp.log !== "0";

  // The related record: fixed when the form was opened from a record, otherwise chosen from the user's open records.
  let parent: { type: string; id: string; name: string; brandId: string | null; regionId: string | null } | null = null;
  if (sp.parentType && sp.parentId) {
    if (sp.parentType === "Lead") {
      const l = await db.lead.findUnique({ where: { id: sp.parentId }, select: { id: true, firstName: true, lastName: true, brandId: true, regionId: true } });
      if (l) parent = { type: "Lead", id: l.id, name: leadName(l), brandId: l.brandId, regionId: l.regionId };
    } else if (sp.parentType === "Deal") {
      const d = await db.deal.findUnique({ where: { id: sp.parentId }, select: { id: true, name: true, brandId: true, regionId: true } });
      if (d) parent = { type: "Deal", id: d.id, name: d.name, brandId: d.brandId, regionId: d.regionId };
    } else if (sp.parentType === "Account") {
      const a = await db.account.findFirst({ where: { id: sp.parentId, deletedAt: null }, select: { id: true, name: true } });
      if (a) parent = { type: "Account", id: a.id, name: a.name, brandId: null, regionId: null };
    }
    if (!parent) notFound(); // missing or outside the user's scope
  }
  const [lookups, leads, deals] = await Promise.all([
    leadFormLookups(ctx),
    parent ? [] : db.lead.findMany({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, select: { id: true, firstName: true, lastName: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    parent ? [] : db.deal.findMany({ where: { stage: { type: "OPEN" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const participants = parent?.brandId && parent.regionId ? (await usersWhoCanSee(ctx, parent.brandId, parent.regionId)).filter((u) => u.id !== ctx.userId) : [];
  const products = lookups.products.filter((p) => !parent?.brandId || p.brandId === parent.brandId);
  const start = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `${sp.date}T09:00` : toLocalInput(new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000));
  const end = toLocalInput(new Date(new Date(`${start}:00+01:00`).getTime() + 3_600_000));
  const qs = (key: string) => {
    const p = new URLSearchParams();
    p.set("type", key);
    if (sp.parentType && sp.parentId) {
      p.set("parentType", sp.parentType);
      p.set("parentId", sp.parentId);
    }
    return `/activities/new?${p}`;
  };
  const cancelHref = parent ? `${PATHS[parent.type]}/${parent.id}` : "/activities";

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitleRow title={isLog ? "Log Call" : def.type === "TEST_DRIVE" ? "Book Test Drive" : `New ${def.label}`} />
      <nav className="mb-3 flex gap-1" aria-label="Activity type">
        {TYPES.filter((t) => t.type !== "TEST_DRIVE" || parent?.type !== "Account").map((t) => (
          <Link
            key={t.key}
            href={qs(t.key)}
            aria-current={t.key === def.key ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1 text-xs font-semibold", t.key === def.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ActionForm action={createActivityAction} className="space-y-4">
        <input type="hidden" name="type" value={def.type} />
        {parent ? <input type="hidden" name="_back" value="parent" /> : null}
        {isLog ? <input type="hidden" name="completed" value="true" /> : null}
        <FormSection title={`${def.label} Information`}>
          <F label="Subject" id="subject" required wide>
            <Input id="subject" name="subject" required maxLength={200} defaultValue={isLog ? "Call" : def.type === "TEST_DRIVE" ? "Test drive" : ""} />
          </F>
          {parent ? (
            <F label="Related to" id="related">
              <input type="hidden" name="parentType" value={parent.type} />
              <input type="hidden" name="parentId" value={parent.id} />
              <Input id="related" value={`${parent.type}: ${parent.name}`} readOnly disabled />
            </F>
          ) : (
            <F label="Related to" id="_parent" required hint="The activity takes its brand and region from this record.">
              <Select id="_parent" name="_parent" required className="w-full" defaultValue="">
                <option value="">Choose a lead or deal…</option>
                <optgroup label="Deals">
                  {deals.map((d) => (
                    <option key={d.id} value={`Deal:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Leads">
                  {leads.map((l) => (
                    <option key={l.id} value={`Lead:${l.id}`}>
                      {leadName(l)}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </F>
          )}
          {parent?.type === "Account" ? (
            <>
              <F label="Brand" id="brandId" required hint="Customers are shared – the activity belongs to one brand.">
                <Select id="brandId" name="brandId" required className="w-full" defaultValue={lookups.defaultBrandId ?? ""}>
                  <option value="">Choose brand…</option>
                  {lookups.brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} – {b.name}
                    </option>
                  ))}
                </Select>
              </F>
              <F label="Region" id="regionId" required>
                <Select id="regionId" name="regionId" required className="w-full" defaultValue={lookups.defaultRegionId ?? ""}>
                  <option value="">Choose region…</option>
                  {lookups.regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </F>
            </>
          ) : null}
          {def.type === "TASK" || (def.type === "CALL" && !isLog) ? (
            <F label={def.type === "CALL" ? "Call at" : "Due"} id="dueAt" required>
              <Input id="dueAt" name="dueAt" type="datetime-local" required defaultValue={start} />
            </F>
          ) : null}
          {def.type === "MEETING" || def.type === "TEST_DRIVE" ? (
            <>
              <F label="Start" id="startAt" required>
                <Input id="startAt" name="startAt" type="datetime-local" required defaultValue={start} />
              </F>
              <F label="End" id="endAt" required>
                <Input id="endAt" name="endAt" type="datetime-local" required defaultValue={end} />
              </F>
            </>
          ) : null}
          {!isLog ? (
            <>
              <F label="Priority" id="priority">
                <Select id="priority" name="priority" defaultValue="NORMAL" className="w-full">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </Select>
              </F>
              <F label="Reminder" id="reminderAt" hint="You get an in-app notification at this time.">
                <Input id="reminderAt" name="reminderAt" type="datetime-local" />
              </F>
            </>
          ) : null}
          {def.type === "TASK" || def.type === "MEETING" ? (
            <F label="Repeat" id="recurrence" hint="The next occurrence is created when this one is completed.">
              <Select id="recurrence" name="recurrence" defaultValue="" className="w-full">
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </F>
          ) : null}
          <F label="Description" id="description" wide>
            <textarea id="description" name="description" rows={3} maxLength={4000} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          </F>
          {participants.length && def.type !== "CALL" ? (
            <F label="Participants" id="participants" wide hint="Only colleagues who can see this record.">
              <MultiPicklist name="participants" options={participants.map((u) => ({ value: u.id, label: u.name }))} />
            </F>
          ) : null}
        </FormSection>
        {def.type === "CALL" ? (
          <FormSection title="Call Details">
            <F label="Direction" id="direction">
              <Select id="direction" name="direction" defaultValue="OUTBOUND" className="w-full">
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
              </Select>
            </F>
            <F label="Phone" id="phone">
              <Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={sp.phone && !sp.phone.includes("*") ? sp.phone : ""} />
            </F>
            {isLog ? (
              <>
                <F label="Duration (seconds)" id="durationSec">
                  <Input id="durationSec" name="durationSec" type="number" min={0} max={86400} inputMode="numeric" />
                </F>
                <F label="Result" id="disposition">
                  <Select id="disposition" name="disposition" defaultValue="CONNECTED" className="w-full">
                    {CALL_DISPOSITIONS.map((d) => (
                      <option key={d} value={d}>
                        {DISPOSITION_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                </F>
                <F label="Outcome" id="outcome" wide>
                  <textarea id="outcome" name="outcome" rows={3} maxLength={2000} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
                </F>
              </>
            ) : null}
          </FormSection>
        ) : null}
        {def.type === "TEST_DRIVE" ? (
          <FormSection title="Demo Vehicle">
            <F label="Model" id="productId" hint="Models of the record's brand only.">
              <Select id="productId" name="productId" defaultValue="" className="w-full">
                <option value="">Choose model…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </F>
            <F label="Demo vehicle VIN" id="vehicleVin" required hint="A vehicle cannot be booked twice for the same time.">
              <Input id="vehicleVin" name="vehicleVin" required maxLength={40} className="font-mono uppercase" />
            </F>
            <F label="Plate number" id="vehiclePlate">
              <Input id="vehiclePlate" name="vehiclePlate" maxLength={20} />
            </F>
            <F label="Location" id="location">
              <Select id="location" name="location" defaultValue="SHOWROOM" className="w-full">
                <option value="SHOWROOM">Showroom</option>
                <option value="HOME">Customer&apos;s home / office</option>
                <option value="OTHER">Other</option>
              </Select>
            </F>
            <F label="Driving licence number" id="licenceNumber" hint="Sensitive – visible to you and your managers only.">
              <Input id="licenceNumber" name="licenceNumber" maxLength={40} autoComplete="off" />
            </F>
            <div className="flex flex-col justify-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="licenceChecked" /> Licence checked
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="indemnitySigned" /> Indemnity form signed
              </label>
            </div>
          </FormSection>
        ) : null}
        <StickyFormFooter cancelHref={cancelHref}>
          <SubmitButton>{isLog ? "Log Call" : def.type === "TEST_DRIVE" ? "Book Test Drive" : "Save"}</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
