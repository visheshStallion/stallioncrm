/**
 * In-app notifications (reminders, mentions, assignments, approvals). RLS lets anyone create a notification
 * for another user, but only the recipient can read or change it. With NOTIFICATION_EMAILS=1 reminders, mentions,
 * assignments and approvals are also emailed (messaging service, prompt 10).
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { enqueueJob } from "@/server/db/jobs";

export type NotificationKind = "REMINDER" | "MENTION" | "ASSIGNED" | "APPROVAL" | "INFO";

const EMAILED = new Set<NotificationKind>(["REMINDER", "MENTION", "ASSIGNED", "APPROVAL"]);

export async function notify(ctx: AccessContext, userIds: string[], n: { kind: NotificationKind; title: string; body?: string | null; href?: string | null }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;
  await scopedDb(ctx).notification.createMany({
    data: ids.map((userId) => ({ userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, href: n.href ?? null })),
  });
  // Optional email copy (NOTIFICATION_EMAILS=1): sent by the messaging service through the job queue.
  if (process.env.NOTIFICATION_EMAILS === "1" && EMAILED.has(n.kind)) {
    const base = (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "");
    const link = n.href ? `\n\n${base}${n.href}` : "";
    await enqueueJob({ type: "email.users", payload: { userIds: ids, subject: n.title.slice(0, 200), text: `${n.body ?? n.title}${link}` } });
  }
}

export async function myNotifications(ctx: AccessContext, take = 15) {
  const db = scopedDb(ctx);
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  return { unread, rows: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, read: !!r.readAt, at: r.createdAt.toISOString() })) };
}

export async function markAllRead(ctx: AccessContext) {
  await scopedDb(ctx).notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}
