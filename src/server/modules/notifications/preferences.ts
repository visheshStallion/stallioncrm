/**
 * Notification preferences (prompt 14). Pure – shared by the server (who gets what, on which channel) and the
 * preferences form. Stored per user under the preference key `notifications`.
 */
import { z } from "zod";

export const NOTIFICATION_KINDS = ["APPROVAL", "ASSIGNED", "MENTION", "REMINDER", "SLA", "STALE_DEAL", "INFO"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const KIND_LABELS: Record<NotificationKind, string> = {
  APPROVAL: "Approvals (requests and decisions)",
  ASSIGNED: "Assignments (leads, cases, activities)",
  MENTION: "Mentions in notes",
  REMINDER: "Activity reminders",
  SLA: "Case SLA breaches",
  STALE_DEAL: "Stale deals",
  INFO: "Other (messages, exports, workflow alerts)",
};

const channel = z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const notificationPrefsSchema = z.object({
  kinds: z.record(z.enum(NOTIFICATION_KINDS), channel).default({}),
  /** no e-mail and no push between these local times (Africa/Lagos); in-app notifications still arrive */
  quietFrom: time.nullable().default(null),
  quietTo: time.nullable().default(null),
  /** one e-mail a day with the unread notifications */
  digest: z.boolean().default(false),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** Without a choice by the user: everything in-app; e-mail and push for what needs action. */
export const DEFAULT_CHANNELS: Record<NotificationKind, { inApp: boolean; email: boolean; push: boolean }> = {
  APPROVAL: { inApp: true, email: true, push: true },
  ASSIGNED: { inApp: true, email: true, push: true },
  MENTION: { inApp: true, email: true, push: true },
  REMINDER: { inApp: true, email: true, push: true },
  SLA: { inApp: true, email: true, push: true },
  STALE_DEAL: { inApp: true, email: false, push: false },
  INFO: { inApp: true, email: false, push: false },
};
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { kinds: {}, quietFrom: null, quietTo: null, digest: false };

export function parseNotificationPrefs(stored: unknown): NotificationPrefs {
  const parsed = notificationPrefsSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;
}

/** "HH:MM" in Africa/Lagos (UTC+1, no daylight saving). */
export function lagosTime(now: Date): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(11, 16);
}

/** Inside the quiet window? The window may cross midnight (22:00 → 06:30). */
export function isQuiet(prefs: Pick<NotificationPrefs, "quietFrom" | "quietTo">, now: Date): boolean {
  const { quietFrom: from, quietTo: to } = prefs;
  if (!from || !to || from === to) return false;
  const t = lagosTime(now);
  return from < to ? t >= from && t < to : t >= from || t < to;
}

/** Channels for one notification to one user at this moment. */
export function channelsFor(prefs: NotificationPrefs, kind: string, now: Date): { inApp: boolean; email: boolean; push: boolean } {
  const k = ((NOTIFICATION_KINDS as readonly string[]).includes(kind) ? kind : "INFO") as NotificationKind;
  const chosen = prefs.kinds[k] ?? DEFAULT_CHANNELS[k];
  const quiet = isQuiet(prefs, now);
  return { inApp: chosen.inApp, email: chosen.email && !quiet, push: chosen.push && !quiet };
}
