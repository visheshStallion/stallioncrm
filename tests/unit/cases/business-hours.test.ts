import { describe, expect, it } from "vitest";
import { addBusinessHours, businessMinutesBetween, DEFAULT_CALENDAR, type BusinessCalendar } from "@/server/modules/cases/business-hours";

// Lagos = UTC+1. 2026-10-05 is a Monday; working hours 08:00–17:00 Lagos = 07:00–16:00 UTC, Monday–Saturday.
const utc = (s: string) => new Date(`${s}Z`);
const cal = (over: Partial<BusinessCalendar> = {}): BusinessCalendar => ({ ...DEFAULT_CALENDAR, holidays: new Set<string>(), ...over });

describe("addBusinessHours", () => {
  it("counts only working hours of the same day", () => {
    expect(addBusinessHours(utc("2026-10-05T08:00:00"), 2, cal())).toEqual(utc("2026-10-05T10:00:00")); // 09:00 → 11:00 Lagos
    expect(addBusinessHours(utc("2026-10-05T07:00:00"), 9, cal())).toEqual(utc("2026-10-05T16:00:00")); // exactly one working day
  });
  it("rolls over to the next working day and starts at opening time", () => {
    expect(addBusinessHours(utc("2026-10-05T15:00:00"), 2, cal())).toEqual(utc("2026-10-06T08:00:00")); // 1 h Monday + 1 h Tuesday
    expect(addBusinessHours(utc("2026-10-05T20:00:00"), 1, cal())).toEqual(utc("2026-10-06T08:00:00")); // after closing
    expect(addBusinessHours(utc("2026-10-05T03:00:00"), 1, cal())).toEqual(utc("2026-10-05T08:00:00")); // before opening
  });
  it("skips Sunday and public holidays; Saturday is a working day", () => {
    expect(addBusinessHours(utc("2026-10-10T15:00:00"), 2, cal())).toEqual(utc("2026-10-12T08:00:00")); // Saturday 16:00 Lagos → Monday
    expect(addBusinessHours(utc("2026-10-11T10:00:00"), 1, cal())).toEqual(utc("2026-10-12T08:00:00")); // Sunday
    const holiday = cal({ holidays: new Set(["2026-10-06"]) });
    expect(addBusinessHours(utc("2026-10-05T15:00:00"), 2, holiday)).toEqual(utc("2026-10-07T08:00:00")); // Tuesday is a holiday
  });
  it("spans several days", () => {
    expect(addBusinessHours(utc("2026-10-05T07:00:00"), 27, cal())).toEqual(utc("2026-10-07T16:00:00")); // three full days
    expect(addBusinessHours(utc("2026-10-09T07:00:00"), 27, cal())).toEqual(utc("2026-10-12T16:00:00")); // Fri, Sat, (Sun), Mon
  });
  it("uses the Lagos calendar day near midnight UTC", () => {
    // 2026-10-10 23:30 UTC is Sunday 00:30 in Lagos → next working time is Monday 08:00 Lagos
    expect(addBusinessHours(utc("2026-10-10T23:30:00"), 1, cal())).toEqual(utc("2026-10-12T08:00:00"));
  });
  it("never loops on an impossible calendar", () => {
    expect(addBusinessHours(utc("2026-10-05T08:00:00"), 2, cal({ workDays: [] }))).toEqual(utc("2026-10-05T10:00:00"));
    expect(addBusinessHours(utc("2026-10-05T08:00:00"), 2, cal({ opensAt: "17:00", closesAt: "08:00" }))).toEqual(utc("2026-10-05T10:00:00"));
    expect(addBusinessHours(utc("2026-10-05T08:00:00"), 0, cal())).toEqual(utc("2026-10-05T08:00:00"));
  });
});

describe("businessMinutesBetween", () => {
  it("is the inverse of addBusinessHours", () => {
    const start = utc("2026-10-09T13:20:00");
    for (const hours of [0.5, 3, 9, 20, 45]) expect(businessMinutesBetween(start, addBusinessHours(start, hours, cal()), cal())).toBe(hours * 60);
  });
  it("is zero outside working time", () => {
    expect(businessMinutesBetween(utc("2026-10-10T17:00:00"), utc("2026-10-12T06:00:00"), cal())).toBe(0);
    expect(businessMinutesBetween(utc("2026-10-12T08:00:00"), utc("2026-10-12T07:00:00"), cal())).toBe(0);
  });
});
