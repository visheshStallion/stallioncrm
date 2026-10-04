import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill, type Tone } from "@/components/crm/primitives";
import { SecretForm } from "@/components/crm/SecretForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { EVENTS } from "@/server/integrations/events";
import { listDeliveries, listSubscriptions } from "@/server/integrations/webhooks";
import { assertAdmin } from "@/server/modules/admin/guard";
import { deleteWebhookAction, redeliverAction, saveWebhookAction } from "@/server/modules/api/actions";
import { listPrincipals } from "@/server/modules/api/tokens";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Webhooks" };
const TONE: Record<string, Tone> = { PENDING: "info", DELIVERED: "success", FAILED: "danger", SKIPPED: "neutral" };
const th = "px-3 py-2";
const head = "border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted";

/** Outbound webhook subscriptions and their delivery log (prompt 13). Administrators only. */
export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const ctx = await requireContext();
  assertAdmin(ctx);
  const [subs, deliveries, principals, dir, prefs] = await Promise.all([listSubscriptions(ctx), listDeliveries(ctx), listPrincipals(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const editing = subs.find((s) => s.id === edit) ?? null;
  const code = (id: string) => dir.brands.find((b) => b.id === id)?.code ?? "?";
  const candidates = [{ id: ctx.userId, name: `${ctx.user.name} (me)` }, ...principals.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))];
  const principalName = (id: string) => candidates.find((c) => c.id === id)?.name ?? "another user";
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-muted">
        A subscription delivers events as HTTPS POST, signed with HMAC-SHA256 (header X-Stallion-Signature). The payload is what the subscription&apos;s principal may see – hidden records are not delivered, masked fields stay masked. Failed deliveries are retried with back-off.
      </p>
      <section className="rounded-lg border border-border bg-surface" data-testid="webhooks">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Subscriptions</h2>
        {subs.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">No subscriptions yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className={head}>
                <th className={th}>Name</th>
                <th className={th}>URL</th>
                <th className={th}>Events</th>
                <th className={th}>Brands</th>
                <th className={th}>Principal</th>
                <th className={th}>State</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-border align-top last:border-0">
                  <td className={th}>
                    <Link href={`/admin/webhooks?edit=${s.id}`} className="font-medium text-primary hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className={`${th} break-all font-mono text-xs`}>{s.url}</td>
                  <td className={th}>{s.events.join(", ")}</td>
                  <td className={th}>{s.brandIds.length ? s.brandIds.map(code).join(", ") : "All of the principal"}</td>
                  <td className={th}>{principalName(s.userId)}</td>
                  <td className={th}>
                    <StatusPill tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Paused"}</StatusPill>
                  </td>
                  <td className={`${th} text-right`}>
                    <ActionForm action={deleteWebhookAction} confirm={`Delete "${s.name}" and its delivery log?`}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Delete
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="webhook-form">
        <h2 className="mb-2 text-[13px] font-semibold">
          {editing ? `Edit: ${editing.name}` : "New subscription"}
          {editing ? (
            <Link href="/admin/webhooks" className="ml-3 text-xs font-normal text-primary underline">
              New subscription instead
            </Link>
          ) : null}
        </h2>
        <SecretForm key={editing?.id ?? "new"} action={saveWebhookAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={80} defaultValue={editing?.name ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="url">URL (https)</Label>
            <Input id="url" name="url" type="url" required maxLength={500} defaultValue={editing?.url ?? ""} placeholder="https://erp.example.com/hooks/stallion" />
          </div>
          <fieldset className="text-[13px] sm:col-span-2">
            <legend className="mb-1 text-xs font-medium">Events</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-1 font-mono text-xs">
                  <input type="checkbox" name="events" value={e} defaultChecked={editing?.events.includes(e) ?? false} /> {e}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-[13px]">
            <legend className="mb-1 text-xs font-medium">Brand filter (none ticked = every brand the principal sees)</legend>
            <div className="flex flex-wrap gap-3">
              {dir.brands.map((b) => (
                <label key={b.id} className="flex items-center gap-1">
                  <input type="checkbox" name="brandIds" value={b.id} defaultChecked={editing?.brandIds.includes(b.id) ?? false} /> {b.code}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="userId">Principal (decides what the payload contains)</Label>
            <Select id="userId" name="userId" required defaultValue={editing?.userId ?? ""} className="w-full">
              <option value="">Choose…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {editing && !candidates.some((c) => c.id === editing.userId) ? <option value={editing.userId}>another user</option> : null}
            </Select>
          </div>
          <div className="flex items-center gap-4 sm:col-span-2">
            {editing ? (
              <label className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" name="active" defaultChecked={editing.active} /> Active
              </label>
            ) : null}
            <SubmitButton>{editing ? "Save subscription" : "Create subscription"}</SubmitButton>
          </div>
        </SecretForm>
      </section>

      <section className="rounded-lg border border-border bg-surface" data-testid="deliveries">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Delivery log (latest 100)</h2>
        {deliveries.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">Nothing delivered yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className={head}>
                <th className={th}>When</th>
                <th className={th}>Subscription</th>
                <th className={th}>Event</th>
                <th className={th}>Brand</th>
                <th className={th}>Status</th>
                <th className={th}>Attempts</th>
                <th className={th}>Result</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className={th}>{formatDateTime(d.createdAt, prefs.dateFormat)}</td>
                  <td className={th}>{d.subscription.name}</td>
                  <td className={`${th} font-mono text-xs`}>{d.event}</td>
                  <td className={th}>{d.brandId ? code(d.brandId) : "—"}</td>
                  <td className={th}>
                    <StatusPill tone={TONE[d.status]}>{d.status.charAt(0) + d.status.slice(1).toLowerCase()}</StatusPill>
                  </td>
                  <td className={`${th} tabular-nums`}>{d.attempts}</td>
                  <td className={`${th} text-text-muted`}>{d.error ?? (d.responseStatus ? `HTTP ${d.responseStatus}` : "")}</td>
                  <td className={`${th} text-right`}>
                    {d.status === "FAILED" || d.status === "SKIPPED" ? (
                      <ActionForm action={redeliverAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Send again
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
