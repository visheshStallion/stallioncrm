import { describe, expect, it } from "vitest";
import { fromLocalInput, localDay, toLocalInput } from "@/lib/format";
import { nextOccurrence, parseRule } from "@/server/modules/activities/recurrence";
import { activitySchema } from "@/server/modules/activities/schema";

describe("recurrence", () => {
  it("parses the supported rules and rejects the rest", () => {
    expect(parseRule("FREQ=WEEKLY;INTERVAL=2")).toEqual({ freq: "WEEKLY", interval: 2, until: null });
    expect(parseRule("RRULE:FREQ=DAILY")?.freq).toBe("DAILY");
    expect(parseRule("FREQ=YEARLY")).toBeNull();
    expect(parseRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(parseRule("")).toBeNull();
  });

  it("computes the next occurrence, clamping month ends and honouring UNTIL", () => {
    const d = (s: string) => new Date(s);
    expect(nextOccurrence("FREQ=DAILY", d("2026-10-04T09:00:00Z"))).toEqual(d("2026-10-05T09:00:00Z"));
    expect(nextOccurrence("FREQ=WEEKLY;INTERVAL=2", d("2026-10-04T09:00:00Z"))).toEqual(d("2026-10-18T09:00:00Z"));
    expect(nextOccurrence("FREQ=MONTHLY", d("2026-01-31T09:00:00Z"))).toEqual(d("2026-02-28T09:00:00Z"));
    expect(nextOccurrence("FREQ=WEEKLY;UNTIL=20261006", d("2026-10-04T09:00:00Z"))).toBeNull();
    expect(nextOccurrence(null, d("2026-10-04T09:00:00Z"))).toBeNull();
  });
});

describe("activity schema", () => {
  const base = { parentType: "Deal", parentId: "d1", subject: "x" };
  it("requires start and end for meetings and test drives, end after start", () => {
    expect(activitySchema.safeParse({ ...base, type: "MEETING" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, type: "MEETING", startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T09:00:00Z" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, type: "MEETING", startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T11:00:00Z" }).success).toBe(true);
  });
  it("only leads and deals can have a test drive; unsupported recurrence is rejected", () => {
    expect(activitySchema.safeParse({ ...base, parentType: "Account", type: "TEST_DRIVE", startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T11:00:00Z" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, type: "TASK", recurrence: "FREQ=HOURLY" }).success).toBe(false);
    expect(activitySchema.parse({ ...base, type: "TASK", vehicleVin: " abc123 " }).vehicleVin).toBe("ABC123");
  });
});

describe("Lagos wall-clock helpers", () => {
  it("converts datetime-local values to instants and back", () => {
    expect(fromLocalInput("2026-10-04T09:30")).toBe("2026-10-04T08:30:00.000Z");
    expect(toLocalInput("2026-10-04T08:30:00.000Z")).toBe("2026-10-04T09:30");
    expect(fromLocalInput("")).toBe("");
    expect(localDay("2026-10-04T23:30:00.000Z")).toBe("2026-10-05");
  });
});
