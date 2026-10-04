/**
 * Business-hours arithmetic for SLA timers (pure, unit-tested). The calendar is the group's: working days
 * (default Monday–Saturday), opening hours in Africa/Lagos time (UTC+1, no DST) and public holidays.
 */
export interface BusinessCalendar {
  /** ISO weekdays: 1 = Monday … 7 = Sunday */
  workDays: number[];
  /** "HH:MM" Lagos time */
  opensAt: string;
  closesAt: string;
  /** Lagos calendar days (YYYY-MM-DD) on which no SLA time runs */
  holidays: Set<string>;
}

export const DEFAULT_CALENDAR: BusinessCalendar = { workDays: [1, 2, 3, 4, 5, 6], opensAt: "08:00", closesAt: "17:00", holidays: new Set() };

const LAGOS = 3_600_000;
const DAY = 86_400_000;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
/** Lagos wall clock as a "UTC" timestamp (so that getUTC* returns Lagos values). */
const toWall = (d: Date) => d.getTime() + LAGOS;
const dayKey = (wall: number) => new Date(wall).toISOString().slice(0, 10);
const isoWeekday = (wall: number) => new Date(wall).getUTCDay() || 7;

function isWorkingDay(wall: number, cal: BusinessCalendar): boolean {
  return cal.workDays.includes(isoWeekday(wall)) && !cal.holidays.has(dayKey(wall));
}

/**
 * The instant `hours` business hours after `start`. Time outside the opening hours, on non-working days and on
 * holidays does not count. A calendar without any working time returns plain elapsed time (never loops).
 */
export function addBusinessHours(start: Date, hours: number, cal: BusinessCalendar = DEFAULT_CALENDAR): Date {
  const open = minutes(cal.opensAt);
  const close = minutes(cal.closesAt);
  if (hours <= 0) return new Date(start);
  if (close <= open || cal.workDays.length === 0) return new Date(start.getTime() + hours * 3_600_000);
  let remaining = Math.round(hours * 60);
  let wall = toWall(start);
  for (let guard = 0; guard < 3700; guard++) {
    const midnight = wall - (wall % DAY);
    const dayOpen = midnight + open * 60_000;
    const dayClose = midnight + close * 60_000;
    if (!isWorkingDay(wall, cal) || wall >= dayClose) {
      wall = midnight + DAY + open * 60_000; // next day's opening
      continue;
    }
    if (wall < dayOpen) wall = dayOpen;
    const available = Math.floor((dayClose - wall) / 60_000);
    if (remaining <= available) return new Date(wall + remaining * 60_000 - LAGOS);
    remaining -= available;
    wall = midnight + DAY + open * 60_000;
  }
  return new Date(start.getTime() + hours * 3_600_000);
}

/** Business minutes between two instants (for "time to resolve" reporting). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar = DEFAULT_CALENDAR): number {
  const open = minutes(cal.opensAt);
  const close = minutes(cal.closesAt);
  if (to <= from) return 0;
  if (close <= open || cal.workDays.length === 0) return Math.round((to.getTime() - from.getTime()) / 60_000);
  const end = toWall(to);
  let wall = toWall(from);
  let total = 0;
  for (let guard = 0; guard < 3700 && wall < end; guard++) {
    const midnight = wall - (wall % DAY);
    if (isWorkingDay(wall, cal)) {
      const a = Math.max(wall, midnight + open * 60_000);
      const b = Math.min(end, midnight + close * 60_000);
      if (b > a) total += Math.round((b - a) / 60_000);
    }
    wall = midnight + DAY;
  }
  return total;
}
