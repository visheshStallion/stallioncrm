import { describe, expect, it } from "vitest";
import { needsWipe } from "@/lib/offline/store";
import { DEFAULT_NOTIFICATION_PREFS, channelsFor, isQuiet, lagosTime, parseNotificationPrefs } from "@/server/modules/notifications/preferences";

describe("offline cache ownership", () => {
  const meta = { userId: "u1", scopeHash: "aaa", generatedAt: "2026-10-01T00:00:00Z" };
  it("is kept for the same user with the same access", () => {
    expect(needsWipe(meta, { userId: "u1", scopeHash: "aaa" })).toBe(false);
    expect(needsWipe(null, { userId: "u1", scopeHash: "aaa" })).toBe(false); // nothing cached yet
  });
  it("is wiped when another user signs in on the device", () => {
    expect(needsWipe(meta, { userId: "u2", scopeHash: "aaa" })).toBe(true);
  });
  it("is wiped when the user's territories or permissions changed", () => {
    expect(needsWipe(meta, { userId: "u1", scopeHash: "bbb" })).toBe(true);
  });
});

describe("notification preferences", () => {
  const at = (hhmmLagos: string) => new Date(`2026-10-05T${hhmmLagos}:00+01:00`);

  it("Lagos time and quiet hours, including a window across midnight", () => {
    expect(lagosTime(new Date("2026-10-05T22:30:00Z"))).toBe("23:30");
    const night = { quietFrom: "22:00", quietTo: "06:30" };
    expect(["21:59", "22:00", "23:59", "00:00", "06:29", "06:30", "12:00"].map((t) => isQuiet(night, at(t)))).toEqual([false, true, true, true, true, false, false]);
    const lunch = { quietFrom: "12:00", quietTo: "13:00" };
    expect(["11:59", "12:00", "12:59", "13:00"].map((t) => isQuiet(lunch, at(t)))).toEqual([false, true, true, false]);
    expect(isQuiet({ quietFrom: null, quietTo: null }, at("03:00"))).toBe(false);
    expect(isQuiet({ quietFrom: "08:00", quietTo: "08:00" }, at("08:00"))).toBe(false);
  });

  it("defaults: everything in app, e-mail and push only for what needs action", () => {
    const p = DEFAULT_NOTIFICATION_PREFS;
    expect(channelsFor(p, "APPROVAL", at("10:00"))).toEqual({ inApp: true, email: true, push: true });
    expect(channelsFor(p, "INFO", at("10:00"))).toEqual({ inApp: true, email: false, push: false });
    expect(channelsFor(p, "SOMETHING_NEW", at("10:00"))).toEqual({ inApp: true, email: false, push: false }); // unknown types behave like INFO
  });

  it("the user's choice per type wins; quiet hours silence e-mail and push but not the in-app list", () => {
    const p = parseNotificationPrefs({ kinds: { APPROVAL: { inApp: true, email: false, push: true }, MENTION: { inApp: false, email: false, push: false } }, quietFrom: "20:00", quietTo: "07:00", digest: true });
    expect(channelsFor(p, "APPROVAL", at("10:00"))).toEqual({ inApp: true, email: false, push: true });
    expect(channelsFor(p, "APPROVAL", at("23:00"))).toEqual({ inApp: true, email: false, push: false });
    expect(channelsFor(p, "MENTION", at("10:00"))).toEqual({ inApp: false, email: false, push: false });
    expect(channelsFor(p, "ASSIGNED", at("23:00"))).toEqual({ inApp: true, email: false, push: false });
  });

  it("invalid stored preferences fall back to the defaults", () => {
    expect(parseNotificationPrefs({ quietFrom: "25:00" })).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs("nonsense")).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});
