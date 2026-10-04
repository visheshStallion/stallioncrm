/**
 * Calendar sync (Microsoft 365) – optional in prompt 13 and NOT implemented: only the adapter interface exists,
 * so a later implementation has a defined seam. Activities already offer an .ics-free in-app calendar; a sync
 * needs per-user OAuth consent (Microsoft Graph `Calendars.ReadWrite`) and is switched on with `CALENDAR_SYNC`.
 */
import "server-only";

export interface CalendarEvent {
  activityId: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
}

export interface CalendarAdapter {
  key: string;
  upsertEvent(userId: string, event: CalendarEvent): Promise<{ externalId: string }>;
  removeEvent(userId: string, externalId: string): Promise<void>;
}

export function calendarAdapter(): CalendarAdapter | null {
  return null; // no adapter is shipped
}
