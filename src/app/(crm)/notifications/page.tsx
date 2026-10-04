import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Pagination } from "@/components/crm/ListPage";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { PushToggle } from "@/components/pwa/PushToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parsePaging } from "@/server/list/filters";
import { markNotificationReadAction, markNotificationsReadAction, saveNotificationPrefsAction } from "@/server/modules/notifications/actions";
import { DEFAULT_CHANNELS, KIND_LABELS, NOTIFICATION_KINDS } from "@/server/modules/notifications/preferences";
import { getNotificationPrefs, listNotifications } from "@/server/modules/notifications/service";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Notifications" };

/** Notification centre: everything addressed to the signed-in user, and how they want to be notified. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ kind?: string; unread?: string; page?: string; per?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const kind = (NOTIFICATION_KINDS as readonly string[]).includes(sp.kind ?? "") ? sp.kind : undefined;
  const [{ rows, total, unread }, prefs, ui] = await Promise.all([listNotifications(ctx, { kind, unread: sp.unread === "1" }, { take: paging.per, skip: paging.skip }), getNotificationPrefs(ctx), getPreferences(ctx)]);
  const chip = "rounded-full border px-3 py-1 text-[13px]";
  const on = "border-primary bg-primary text-primary-foreground";
  const href = (k?: string, u?: boolean) => `/notifications?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(u ? { unread: "1" } : {}) }).toString()}`;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageTitleRow
        title="Notifications"
        left={<span className="text-[13px] text-text-muted">{unread} unread</span>}
        actions={
          unread ? (
            <form action={markNotificationsReadAction as unknown as (fd: FormData) => Promise<void>}>
              <SubmitButton size="sm" variant="outline">
                Mark all read
              </SubmitButton>
            </form>
          ) : null
        }
      />
      <nav className="flex flex-wrap gap-1" aria-label="Notification types">
        <Link href={href(undefined, sp.unread === "1")} className={cn(chip, !kind ? on : "border-border bg-surface hover:bg-muted")}>
          All
        </Link>
        {NOTIFICATION_KINDS.map((k) => (
          <Link key={k} href={href(k, sp.unread === "1")} className={cn(chip, kind === k ? on : "border-border bg-surface hover:bg-muted")}>
            {KIND_LABELS[k].split(" (")[0]}
          </Link>
        ))}
        <Link href={href(kind, sp.unread !== "1")} className={cn(chip, "ml-auto", sp.unread === "1" ? on : "border-border bg-surface hover:bg-muted")}>
          Unread only
        </Link>
      </nav>
      <section className="rounded-lg border border-border bg-surface" data-testid="notification-list">
        {rows.length === 0 ? (
          <EmptyState title="Nothing here" text="You're all caught up." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 px-4 py-2.5 text-[13px]", !n.read && "bg-primary/5")}>
                <StatusPill>{KIND_LABELS[n.kind as keyof typeof KIND_LABELS]?.split(" (")[0] ?? n.kind}</StatusPill>
                <div className="min-w-0 flex-1">
                  {n.href ? (
                    <Link href={n.href} className={cn("text-primary hover:underline", !n.read && "font-semibold")}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className={cn(!n.read && "font-semibold")}>{n.title}</span>
                  )}
                  {n.body ? <div className="truncate text-xs text-text-muted">{n.body}</div> : null}
                </div>
                <span className="whitespace-nowrap text-xs text-text-muted">{formatDateTime(n.at, ui.dateFormat)}</span>
                {!n.read ? (
                  <ActionForm action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton size="sm" variant="ghost">
                      Mark read
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Pagination total={total} page={paging.page} per={paging.per} />

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="notification-prefs">
        <h2 className="mb-2 text-[13px] font-semibold">How I want to be notified</h2>
        <ActionForm action={saveNotificationPrefsAction} className="space-y-3">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase text-text-muted">
                <th className="py-1">Type</th>
                <th className="w-20 text-center">In app</th>
                <th className="w-20 text-center">E-mail</th>
                <th className="w-20 text-center">Push</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_KINDS.map((k) => {
                const c = prefs.kinds[k] ?? DEFAULT_CHANNELS[k];
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="py-1.5">{KIND_LABELS[k]}</td>
                    {(["inApp", "email", "push"] as const).map((ch) => (
                      <td key={ch} className="text-center">
                        <input type="checkbox" name={`${k}:${ch}`} defaultChecked={c[ch]} aria-label={`${KIND_LABELS[k]} – ${ch === "inApp" ? "in app" : ch}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="quietFrom">Quiet hours from</Label>
              <Input id="quietFrom" name="quietFrom" type="time" defaultValue={prefs.quietFrom ?? ""} className="w-32" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quietTo">to</Label>
              <Input id="quietTo" name="quietTo" type="time" defaultValue={prefs.quietTo ?? ""} className="w-32" />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-[13px]">
              <input type="checkbox" name="digest" defaultChecked={prefs.digest} /> Daily e-mail digest of unread notifications
            </label>
            <SubmitButton>Save preferences</SubmitButton>
          </div>
          <p className="text-xs text-text-muted">During quiet hours (Lagos time) no e-mail and no push is sent; notifications still appear here. E-mail copies need the e-mail option of the installation.</p>
        </ActionForm>
        <div className="mt-3 border-t border-border pt-3">
          <PushToggle />
        </div>
      </section>
    </div>
  );
}
