import { describe, expect, it } from "vitest";
import { allowedTargets, canTransition, missingRequirements, parseStringArray, staleness, type StageLike } from "@/server/modules/deals/blueprint";

const stage = (key: string, order: number, type: StageLike["type"] = "OPEN", requiredFields: string[] = [], allowedTransitions: string[] | null = null): StageLike => ({
  id: key,
  key,
  name: key,
  order,
  type,
  requiredFields,
  allowedTransitions,
});

const STAGES = [
  stage("ENQUIRY", 1),
  stage("TEST_DRIVE", 2, "OPEN", ["testDriveDate", "modelId"]),
  stage("QUOTATION", 3, "OPEN", ["quote"]),
  stage("BOOKING", 4, "OPEN", ["depositAmount", "depositReceiptNo"]),
  stage("FINANCE_PAYMENT", 5),
  stage("DELIVERY", 6, "OPEN", ["vinChassisNo", "deliveryDate"]),
  stage("CLOSED_WON", 7, "WON"),
  stage("CLOSED_LOST", 8, "LOST", ["lossReason"]),
];
const by = (k: string) => STAGES.find((s) => s.key === k)!;

describe("Blueprint transitions", () => {
  it("default rule: previous, next or lost", () => {
    expect(allowedTargets(STAGES, by("QUOTATION"))).toEqual(["TEST_DRIVE", "BOOKING", "CLOSED_LOST"]);
    expect(allowedTargets(STAGES, by("ENQUIRY"))).toEqual(["TEST_DRIVE", "CLOSED_LOST"]);
    expect(allowedTargets(STAGES, by("DELIVERY"))).toEqual(["FINANCE_PAYMENT", "CLOSED_WON", "CLOSED_LOST"]);
  });

  it("a sales exec cannot skip stages; a manager can", () => {
    expect(canTransition(STAGES, by("ENQUIRY"), by("BOOKING"), false)).toBe(false);
    expect(canTransition(STAGES, by("ENQUIRY"), by("BOOKING"), true)).toBe(true);
    expect(canTransition(STAGES, by("ENQUIRY"), by("TEST_DRIVE"), false)).toBe(true);
    expect(canTransition(STAGES, by("BOOKING"), by("CLOSED_LOST"), false)).toBe(true);
    expect(canTransition(STAGES, by("BOOKING"), by("BOOKING"), true)).toBe(false);
  });

  it("a lost deal can only be re-opened at the first stage (unless manager)", () => {
    expect(allowedTargets(STAGES, by("CLOSED_LOST"))).toEqual(["ENQUIRY"]);
    expect(canTransition(STAGES, by("CLOSED_LOST"), by("DELIVERY"), false)).toBe(false);
  });

  it("configured transitions override the default rule", () => {
    const custom = STAGES.map((s) => (s.key === "ENQUIRY" ? { ...s, allowedTransitions: ["QUOTATION", "NOPE", "ENQUIRY"] } : s));
    const enquiry = custom.find((s) => s.key === "ENQUIRY")!;
    expect(allowedTargets(custom, enquiry)).toEqual(["QUOTATION"]);
    expect(canTransition(custom, enquiry, by("TEST_DRIVE"), false)).toBe(false);
  });
});

describe("Blueprint requirements (BUSINESS_CONTEXT §9)", () => {
  it("cannot enter Delivery without VIN and delivery date", () => {
    expect(missingRequirements(by("DELIVERY"), { vinChassisNo: null, deliveryDate: null })).toEqual(["vinChassisNo", "deliveryDate"]);
    expect(missingRequirements(by("DELIVERY"), { vinChassisNo: "VIN123", deliveryDate: "2026-10-10" })).toEqual([]);
  });

  it("Booking needs deposit + receipt; Closed Lost needs a reason; Test Drive needs date + model", () => {
    expect(missingRequirements(by("BOOKING"), { depositAmount: 500000, depositReceiptNo: "" })).toEqual(["depositReceiptNo"]);
    expect(missingRequirements(by("CLOSED_LOST"), {})).toEqual(["lossReason"]);
    expect(missingRequirements(by("TEST_DRIVE"), { testDriveDate: "2026-10-05", modelId: "m1" })).toEqual([]);
  });

  it("named checks: failing check blocks, absent check (module not built) does not", () => {
    expect(missingRequirements(by("QUOTATION"), {}, { quote: false })).toEqual(["quote"]);
    expect(missingRequirements(by("QUOTATION"), {}, { quote: true })).toEqual([]);
    expect(missingRequirements(by("QUOTATION"), {}, {})).toEqual([]);
  });
});

describe("stale indicator", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  it("stale when days in stage exceed the stage limit (open stages only)", () => {
    expect(staleness("2026-10-01T00:00:00Z", 7, "OPEN", now)).toEqual({ days: 19, stale: true });
    expect(staleness("2026-10-15T00:00:00Z", 7, "OPEN", now)).toEqual({ days: 5, stale: false });
    expect(staleness("2026-10-01T00:00:00Z", null, "OPEN", now).stale).toBe(false);
    expect(staleness("2026-10-01T00:00:00Z", 7, "WON", now).stale).toBe(false);
  });
  it("parses JSON arrays defensively", () => {
    expect(parseStringArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(parseStringArray("nope")).toEqual([]);
  });
});
