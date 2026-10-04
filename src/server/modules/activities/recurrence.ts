/**
 * Minimal RRULE support for recurring tasks and meetings (pure, unit-tested):
 * FREQ=DAILY|WEEKLY|MONTHLY with optional INTERVAL and UNTIL. The next occurrence is created when the
 * current one is completed.
 */
export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  until: Date | null;
}

export function parseRule(rrule: string | null | undefined): Rule | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("=").map((x) => x.trim().toUpperCase()) as [string, string]),
  );
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(parts.FREQ ?? "")) return null;
  const interval = Number(parts.INTERVAL ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return null;
  let until: Date | null = null;
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (!m) return null;
    until = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
  }
  return { freq: parts.FREQ as Rule["freq"], interval, until };
}

/** The occurrence after `from`, or null when the rule has ended or is invalid. */
export function nextOccurrence(rrule: string | null | undefined, from: Date): Date | null {
  const rule = parseRule(rrule);
  if (!rule) return null;
  const next = new Date(from);
  if (rule.freq === "DAILY") next.setUTCDate(next.getUTCDate() + rule.interval);
  else if (rule.freq === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * rule.interval);
  else {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + rule.interval);
    const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, last));
  }
  return rule.until && next > rule.until ? null : next;
}

export const RECURRENCE_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "FREQ=DAILY", label: "Daily" },
  { value: "FREQ=WEEKLY", label: "Weekly" },
  { value: "FREQ=WEEKLY;INTERVAL=2", label: "Every 2 weeks" },
  { value: "FREQ=MONTHLY", label: "Monthly" },
] as const;
