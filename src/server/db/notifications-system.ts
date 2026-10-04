/**
 * System reads for notification delivery (prompt 14). A notification is created by one user for another;
 * the sender's session cannot read the recipient's preferences or push subscriptions (RLS: own rows), so the
 * delivery code reads exactly those here – and nothing else.
 */
import "server-only";
import { unsafeDb } from "./unsafe";

/** Stored notification preferences of the recipients (missing = defaults). Inactive users are left out. */
export async function recipientPreferences(userIds: string[]): Promise<Map<string, unknown>> {
  const [users, rows] = await Promise.all([unsafeDb.user.findMany({ where: { id: { in: userIds }, active: true, isIntegration: false }, select: { id: true } }), unsafeDb.userPreference.findMany({ where: { userId: { in: userIds }, key: "notifications" }, select: { userId: true, value: true } })]);
  const stored = new Map(rows.map((r) => [r.userId, r.value as unknown]));
  return new Map(users.map((u) => [u.id, stored.get(u.id) ?? null]));
}

export function pushSubscriptionsOf(userIds: string[]) {
  return unsafeDb.pushSubscription.findMany({ where: { userId: { in: userIds } } });
}

/** The push service says the subscription is gone (404 / 410). */
export async function dropPushSubscription(endpoint: string): Promise<void> {
  await unsafeDb.pushSubscription.deleteMany({ where: { endpoint } });
}

/** Users who asked for the daily digest, with their unread notifications of the last day. */
export async function digestCandidates(since: Date) {
  const prefs = await unsafeDb.userPreference.findMany({ where: { key: "notifications", value: { path: ["digest"], equals: true }, user: { active: true } }, select: { userId: true } });
  const ids = prefs.map((p) => p.userId);
  if (ids.length === 0) return [];
  const rows = await unsafeDb.notification.findMany({ where: { userId: { in: ids }, readAt: null, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { userId: true, title: true, body: true, href: true, kind: true } });
  return ids.map((userId) => ({ userId, items: rows.filter((r) => r.userId === userId).slice(0, 50) })).filter((u) => u.items.length > 0);
}

/** Open deals nobody touched since `before`, without a stale-deal notification since then. */
export async function staleDeals(before: Date, take = 200) {
  const deals = await unsafeDb.deal.findMany({ where: { deletedAt: null, updatedAt: { lt: before }, stage: { type: "OPEN" }, owner: { active: true } }, select: { id: true, name: true, ownerId: true, brandId: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take });
  if (deals.length === 0) return [];
  const told = await unsafeDb.notification.findMany({ where: { kind: "STALE_DEAL", href: { in: deals.map((d) => `/deals/${d.id}`) }, createdAt: { gte: before } }, select: { href: true, userId: true } });
  const seen = new Set(told.map((t) => `${t.userId}|${t.href}`));
  return deals.filter((d) => !seen.has(`${d.ownerId}|/deals/${d.id}`));
}
