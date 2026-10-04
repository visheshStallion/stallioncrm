/**
 * Notifications (prompts 07 and 14): in-app notification centre, e-mail, web push and a daily digest.
 *
 * WHO is notified is decided by the caller – always users who can see the record (owner, approver, mentioned
 * colleague with access …). This module decides HOW: each recipient's preferences per notification type and
 * their quiet hours. RLS lets anyone create a notification for another user, but only the recipient can read it.
 * A push message carries the title and the link only; the record is loaded – with the recipient's own access –
 * when they open it.
 */
import "server-only";
import type { Job } from "@prisma/client";
import { hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";
import { digestCandidates, dropPushSubscription, pushSubscriptionsOf, recipientPreferences, staleDeals } from "@/server/db/notifications-system";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { channelsFor, lagosTime, notificationPrefsSchema, parseNotificationPrefs, type NotificationKind, type NotificationPrefs } from "./preferences";

export type { NotificationKind };

const appUrl = () => (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "");
export const pushConfigured = () => !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

export async function notify(ctx: AccessContext, userIds: string[], n: { kind: NotificationKind; title: string; body?: string | null; href?: string | null }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;
  const now = new Date();
  const prefs = await recipientPreferences(ids); // active recipients only
  const plan = [...prefs].map(([userId, stored]) => ({ userId, ...channelsFor(parseNotificationPrefs(stored), n.kind, now) }));
  const title = n.title.slice(0, 200);
  const inApp = plan.filter((p) => p.inApp).map((p) => p.userId);
  if (inApp.length) {
    await scopedDb(ctx).notification.createMany({ data: inApp.map((userId) => ({ userId, kind: n.kind, title, body: n.body?.slice(0, 500) ?? null, href: n.href ?? null })) });
  }
  // E-mail copy (NOTIFICATION_EMAILS=1), sent by the messaging service through the job queue.
  const email = plan.filter((p) => p.email).map((p) => p.userId);
  if (process.env.NOTIFICATION_EMAILS === "1" && email.length) {
    const link = n.href ? `\n\n${appUrl()}${n.href}` : "";
    await enqueueJob({ type: "email.users", payload: { userIds: email, subject: title, text: `${n.body ?? n.title}${link}` } });
  }
  const push = plan.filter((p) => p.push).map((p) => p.userId);
  if (pushConfigured() && push.length) await enqueueJob({ type: "push.send", payload: { userIds: push, title, href: n.href ?? "/notifications" }, maxAttempts: 2 });
}

/** Job handler "push.send": to the browsers the recipients subscribed with. Dead subscriptions are removed. */
export async function sendPush(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { userIds, title, href } = job.payload as { userIds: string[]; title: string; href: string };
  if (!pushConfigured()) return { skipped: "web push is not configured" };
  const subs = await pushSubscriptionsOf(userIds);
  if (subs.length === 0) return { sent: 0 };
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:crm@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, href }), { TTL: 3600 });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await dropPushSubscription(s.endpoint);
      else logger.warn({ err, status }, "web push failed");
    }
  }
  return { sent, subscriptions: subs.length };
}

// ───────────────────────────── notification centre ─────────────────────────────

const row = (r: { id: string; kind: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date }) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, read: !!r.readAt, at: r.createdAt.toISOString() });

export async function myNotifications(ctx: AccessContext, take = 15) {
  const db = scopedDb(ctx);
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  return { unread, rows: rows.map(row) };
}

export async function listNotifications(ctx: AccessContext, f: { kind?: string; unread?: boolean } = {}, opts: { take?: number; skip?: number } = {}) {
  const db = scopedDb(ctx);
  const where = { userId: ctx.userId, ...(f.kind ? { kind: f.kind } : {}), ...(f.unread ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(opts.take ?? 50, 200), skip: opts.skip ?? 0 }), db.notification.count({ where }), db.notification.count({ where: { userId: ctx.userId, readAt: null } })]);
  return { rows: rows.map(row), total, unread };
}

export async function markAllRead(ctx: AccessContext) {
  await scopedDb(ctx).notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markRead(ctx: AccessContext, id: string) {
  await scopedDb(ctx).notification.updateMany({ where: { id, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}

// ───────────────────────────── preferences & push subscriptions ─────────────────────────────

export async function getNotificationPrefs(ctx: AccessContext): Promise<NotificationPrefs> {
  const stored = await scopedDb(ctx).userPreference.findUnique({ where: { userId_key: { userId: ctx.userId, key: "notifications" } } });
  return parseNotificationPrefs(stored?.value);
}

export async function saveNotificationPrefs(ctx: AccessContext, input: unknown) {
  const data = notificationPrefsSchema.parse(input);
  if ((data.quietFrom === null) !== (data.quietTo === null)) throw new BadRequestError("Enter both the start and the end of the quiet hours");
  await scopedDb(ctx).userPreference.upsert({ where: { userId_key: { userId: ctx.userId, key: "notifications" } }, update: { value: data }, create: { userId: ctx.userId, key: "notifications", value: data } });
}

export async function savePushSubscription(ctx: AccessContext, input: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, userAgent: string | null) {
  if (ctx.tokenId || ctx.system) throw new BadRequestError("Push subscriptions belong to a signed-in browser");
  const endpoint = String(input.endpoint ?? "");
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !input.keys?.p256dh || !input.keys.auth) throw new BadRequestError("Invalid push subscription");
  const db = scopedDb(ctx);
  // a browser that changes user (shared showroom device) must not keep delivering to the previous user
  await dropPushSubscription(endpoint);
  await db.pushSubscription.create({ data: { userId: ctx.userId, endpoint, p256dh: input.keys.p256dh.slice(0, 200), auth: input.keys.auth.slice(0, 100), userAgent: userAgent?.slice(0, 200) ?? null } });
}

export async function removePushSubscription(ctx: AccessContext, endpoint: string) {
  await scopedDb(ctx).pushSubscription.deleteMany({ where: { userId: ctx.userId, endpoint } });
}

export async function myPushSubscriptions(ctx: AccessContext) {
  return scopedDb(ctx).pushSubscription.count({ where: { userId: ctx.userId } });
}

// ───────────────────────────── scheduler ─────────────────────────────

/** Daily digest (after 07:00 Lagos): one e-mail with yesterday's unread notifications to users who asked for it. */
export async function sendDigests(now = new Date()): Promise<number> {
  if (lagosTime(now) < "07:00") return 0;
  const day = new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
  let queued = 0;
  for (const u of await digestCandidates(new Date(now.getTime() - 86_400_000))) {
    const lines = u.items.map((i) => `• ${i.title}${i.href ? `\n  ${appUrl()}${i.href}` : ""}`).join("\n");
    // the idempotency key makes this one digest per user and day, however often the tick runs
    if (await enqueueJob({ type: "email.users", payload: { userIds: [u.userId], subject: `Your StallionCRM digest: ${u.items.length} unread notification${u.items.length === 1 ? "" : "s"}`, text: `${lines}\n\n${appUrl()}/notifications` }, idempotencyKey: `digest:${u.userId}:${day}` })) queued++;
  }
  return queued;
}

const STALE_DAYS = 14;

/** Open deals without any change for two weeks: the owner is told once per period. */
export async function notifyStaleDeals(systemCtx: (brandId: string) => AccessContext, now = new Date()): Promise<number> {
  const deals = await staleDeals(new Date(now.getTime() - STALE_DAYS * 86_400_000));
  for (const d of deals) await notify(systemCtx(d.brandId), [d.ownerId], { kind: "STALE_DEAL", title: `No activity for ${STALE_DAYS} days: ${d.name}`, body: "Update the deal or close it.", href: `/deals/${d.id}` });
  return deals.length;
}

/** For the notification centre: is the bell's "push" switch meaningful for this user? */
export const canUsePush = (ctx: AccessContext) => pushConfigured() && !ctx.system && hasPermission(ctx, "activities", "read");
