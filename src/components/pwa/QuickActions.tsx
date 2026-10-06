"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { available, outbox, readRecords, settle, type OutboxItem } from "@/lib/offline/store";
import { flushOutbox, submitAction, type SubmitOutcome } from "@/lib/offline/sync";

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const digits = (v: unknown) => str(v).replace(/[^\d+]/g, "");
const waLink = (v: unknown) => `https://wa.me/${digits(v).replace(/^\+/, "").replace(/^0/, "234")}`;
const field = "h-11 text-base";

/**
 * Field quick actions for the phone: create a lead, log a call, add a note. Online they are applied at once;
 * offline they go to the outbox and are sent when the connection is back. The record pickers and the lists come
 * from the device's offline cache – the user's own leads and deals only.
 */
export function QuickActions({ brands, regions, offlinePage = false }: { brands?: Array<{ id: string; code: string }>; regions?: Array<{ id: string; name: string }>; offlinePage?: boolean }) {
  const [leads, setLeads] = useState<Rec[]>([]);
  const [deals, setDeals] = useState<Rec[]>([]);
  const [activities, setActivities] = useState<Rec[]>([]);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!available()) return;
    const [l, d, a, o] = await Promise.all([readRecords("leads"), readRecords("deals"), readRecords("activities"), outbox()]);
    setLeads(l);
    setDeals(d);
    setActivities(a);
    setItems(o);
    window.dispatchEvent(new Event("stallion:outbox"));
  };
  useEffect(() => {
    void reload();
  }, []);

  const report = (o: SubmitOutcome, what: string) => setMessage(o.state === "done" ? `${what} saved` : o.state === "queued" ? `${what} saved on this device – it is sent when you are back online` : o.message);
  async function run(e: React.FormEvent<HTMLFormElement>, type: OutboxItem["type"], what: string, build: (fd: FormData) => { payload: Rec; label: string }) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      const { payload, label } = build(new FormData(form));
      const outcome = await submitAction(type, payload, label);
      report(outcome, what);
      if (outcome.state !== "refused") form.reset();
      await reload();
    } finally {
      setBusy(false);
    }
  }
  const targets = [...leads.map((l) => ({ value: `Lead:${str(l.id)}`, label: `Lead · ${str(l.name)}`, phone: str(l.mobile) })), ...deals.map((d) => ({ value: `Deal:${str(d.id)}`, label: `Deal · ${str(d.name)}`, phone: "" }))];
  const target = (fd: FormData) => {
    const [type, id] = String(fd.get("target") ?? "").split(":");
    return { type: type ?? "", id: id ?? "", label: targets.find((t) => t.value === fd.get("target"))?.label ?? "" };
  };
  // offline the brand and region of a new lead come from the cached records (the user's own brands)
  const brandOptions = brands ?? [...new Map([...leads, ...deals].map((r) => [str(r.brandId), { id: str(r.brandId), code: "Brand of my records" }])).values()];
  const regionOptions = regions ?? [...new Map([...leads, ...deals].map((r) => [str(r.regionId), { id: str(r.regionId), name: "Region of my records" }])).values()];

  return (
    <div className="mx-auto max-w-xl space-y-4" data-testid="quick-actions">
      {message ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-[13px]" data-testid="quick-message">
          {message}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Log a call</h2>
        <form className="space-y-2" onSubmit={(e) => run(e, "call.log", "Call", (fd) => ({ payload: { parentType: target(fd).type, parentId: target(fd).id, subject: str(fd.get("subject")) || "Call", outcome: str(fd.get("outcome")), direction: "OUTBOUND" }, label: `Call – ${target(fd).label}` }))}>
          <Label htmlFor="call-target">Lead or deal</Label>
          <Select id="call-target" name="target" required defaultValue="" className={`${field} w-full`}>
            <option value="">Choose…</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Label htmlFor="call-outcome">What was said</Label>
          <Input id="call-outcome" name="outcome" required maxLength={2000} className={field} />
          <Button type="submit" disabled={busy} className="h-11 w-full">
            Save call
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Add a note</h2>
        <form className="space-y-2" onSubmit={(e) => run(e, "note.add", "Note", (fd) => ({ payload: { entity: target(fd).type, entityId: target(fd).id, body: str(fd.get("body")) }, label: `Note – ${target(fd).label}` }))}>
          <Label htmlFor="note-target">Lead or deal</Label>
          <Select id="note-target" name="target" required defaultValue="" className={`${field} w-full`}>
            <option value="">Choose…</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Label htmlFor="note-body">Note</Label>
          <textarea id="note-body" name="body" required maxLength={5000} rows={3} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base" />
          <Button type="submit" disabled={busy} className="h-11 w-full">
            Save note
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">New lead</h2>
        <form className="space-y-2" onSubmit={(e) => run(e, "lead.create", "Lead", (fd) => ({ payload: { firstName: str(fd.get("firstName")), lastName: str(fd.get("lastName")), company: str(fd.get("company")), mobile: str(fd.get("mobile")), source: "WALK_IN", brandId: str(fd.get("brandId")), regionId: str(fd.get("regionId")) }, label: `Lead – ${str(fd.get("lastName")) || str(fd.get("company"))}` }))}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="lead-first">First name</Label>
              <Input id="lead-first" name="firstName" maxLength={80} className={field} />
            </div>
            <div>
              <Label htmlFor="lead-last">Last name (or company)</Label>
              <Input id="lead-last" name="lastName" maxLength={80} className={field} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="lead-company">Company</Label>
              <Input id="lead-company" name="company" maxLength={160} className={field} />
            </div>
          </div>
          <Label htmlFor="lead-mobile">Mobile</Label>
          <Input id="lead-mobile" name="mobile" required inputMode="tel" maxLength={20} className={field} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="lead-brand">Brand</Label>
              <Select id="lead-brand" name="brandId" required defaultValue={brandOptions.length === 1 ? brandOptions[0]!.id : ""} className={`${field} w-full`}>
                <option value="">Choose…</option>
                {brandOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lead-region">Region</Label>
              <Select id="lead-region" name="regionId" required defaultValue={regionOptions.length === 1 ? regionOptions[0]!.id : ""} className={`${field} w-full`}>
                <option value="">Choose…</option>
                {regionOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={busy} className="h-11 w-full">
            Save lead
          </Button>
        </form>
      </section>

      {items.length ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="outbox">
          <h2 className="mb-2 text-sm font-semibold">Saved on this device</h2>
          <ul className="space-y-2 text-[13px]">
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-2">
                <span className="flex-1">
                  {i.label}
                  <span className="block text-xs text-text-muted">{i.failed ? `Not applied: ${i.failed}` : "Waiting for a connection"}</span>
                </span>
                {i.failed ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => settle(i.key).then(reload)}>
                    Discard
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="mt-3 h-11 w-full" disabled={busy} onClick={() => flushOutbox().then(reload)}>
            Send now
          </Button>
        </section>
      ) : null}

      {offlinePage ? (
        <>
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="offline-leads">
            <h2 className="mb-2 text-sm font-semibold">My leads ({leads.length})</h2>
            <ul className="divide-y divide-border text-[13px]">
              {leads.map((l) => (
                <li key={str(l.id)} className="flex items-center gap-3 py-2">
                  <span className="flex-1">
                    {str(l.name)}
                    <span className="block text-xs text-text-muted">{[str(l.status).toLowerCase(), str(l.modelName), str(l.city)].filter(Boolean).join(" · ")}</span>
                  </span>
                  {digits(l.mobile) && !str(l.mobile).includes("*") ? (
                    <>
                      <a href={`tel:${digits(l.mobile)}`} className="rounded-md border border-border px-3 py-2">
                        Call
                      </a>
                      <a href={waLink(l.mobile)} className="rounded-md border border-border px-3 py-2">
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="offline-deals">
            <h2 className="mb-2 text-sm font-semibold">My open deals ({deals.length})</h2>
            <ul className="divide-y divide-border text-[13px]">
              {deals.map((d) => (
                <li key={str(d.id)} className="py-2">
                  {str(d.name)}
                  <span className="block text-xs text-text-muted">{[str(d.customerName), str(d.stageName), str(d.modelName)].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="offline-activities">
            <h2 className="mb-2 text-sm font-semibold">My activities ({activities.length})</h2>
            <ul className="divide-y divide-border text-[13px]">
              {activities.map((a) => (
                <li key={str(a.id)} className="py-2">
                  {str(a.subject)}
                  <span className="block text-xs text-text-muted">{[str(a.type).toLowerCase().replace(/_/g, " "), str(a.dueAt || a.startAt).slice(0, 16).replace("T", " ")].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
