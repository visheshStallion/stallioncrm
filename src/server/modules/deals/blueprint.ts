/**
 * Blueprint rules (BUSINESS_CONTEXT §9, prompt 04) – pure functions, unit-tested.
 *
 * 1. Transitions: from a stage a user may move to the previous or next stage (by order) or to a LOST stage.
 *    A stage may override this with `allowedTransitions` (stage keys). Managers of the deal's brand
 *    (Brand Manager, RSM for their regions, Management, Administrator) may move to any stage.
 * 2. Requirements: to ENTER a stage, every requirement key in `requiredFields` must be satisfied – either a
 *    deal field that is filled, or a named check (e.g. "quote": a quote exists for the deal).
 */

export interface StageLike {
  id: string;
  key: string;
  name: string;
  order: number;
  type: "OPEN" | "WON" | "LOST";
  requiredFields: string[];
  allowedTransitions: string[] | null;
}

/** Requirement keys that are deal fields, with their form metadata (used by the Blueprint dialog). */
export const REQUIREMENT_FIELDS = {
  testDriveDate: { label: "Test drive date", input: "date" },
  modelId: { label: "Model", input: "model" },
  depositAmount: { label: "Deposit amount", input: "money" },
  depositReceiptNo: { label: "Deposit receipt no.", input: "text" },
  vinChassisNo: { label: "VIN / chassis no.", input: "text" },
  engineNo: { label: "Engine no.", input: "text" },
  deliveryDate: { label: "Delivery date", input: "date" },
  lossReason: { label: "Loss reason", input: "text" },
  lossCompetitorBrand: { label: "Lost to (competitor brand)", input: "text" },
  amount: { label: "Amount", input: "money" },
  closeDate: { label: "Expected close date", input: "date" },
  paymentType: { label: "Payment type", input: "payment" },
  financeBank: { label: "Finance bank", input: "text" },
  colour: { label: "Colour", input: "text" },
} as const;
export type RequirementField = keyof typeof REQUIREMENT_FIELDS;

/** Named checks that are not simple fields. */
export const REQUIREMENT_CHECKS = {
  quote: "A quote exists for the deal",
} as const;
export type RequirementCheck = keyof typeof REQUIREMENT_CHECKS;

export const ALL_REQUIREMENT_KEYS = [...Object.keys(REQUIREMENT_FIELDS), ...Object.keys(REQUIREMENT_CHECKS)];

export const requirementLabel = (key: string): string =>
  (REQUIREMENT_FIELDS as Record<string, { label: string }>)[key]?.label ?? (REQUIREMENT_CHECKS as Record<string, string>)[key] ?? key;

export const isRequirementField = (key: string): key is RequirementField => key in REQUIREMENT_FIELDS;

export function parseStringArray(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : [];
}

/** Stage keys a NON-manager may move to from `from`. */
export function allowedTargets(stages: StageLike[], from: StageLike): string[] {
  if (from.allowedTransitions) return from.allowedTransitions.filter((k) => k !== from.key && stages.some((s) => s.key === k));
  const ordered = [...stages].filter((s) => s.type !== "LOST").sort((a, b) => a.order - b.order);
  const i = ordered.findIndex((s) => s.id === from.id);
  const lost = stages.filter((s) => s.type === "LOST").map((s) => s.key);
  if (i < 0) {
    // From a LOST stage: back to the first stage (re-open) only.
    return ordered[0] ? [ordered[0].key] : [];
  }
  return [ordered[i - 1]?.key, ordered[i + 1]?.key, ...lost].filter((k): k is string => !!k);
}

export function canTransition(stages: StageLike[], from: StageLike, to: StageLike, isManager: boolean): boolean {
  if (from.id === to.id) return false;
  if (isManager) return true;
  return allowedTargets(stages, from).includes(to.key);
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== "";

/**
 * Requirement keys of `stage` that are NOT satisfied by the deal (after applying the values being submitted).
 * `checks` supplies the result of named checks (e.g. { quote: true }); an absent check counts as satisfied
 * so that modules not built yet do not block the pipeline.
 */
export function missingRequirements(stage: StageLike, deal: Record<string, unknown>, checks: Partial<Record<RequirementCheck, boolean>> = {}): string[] {
  return stage.requiredFields.filter((key) => {
    if (isRequirementField(key)) return !filled(deal[key]);
    if (key in REQUIREMENT_CHECKS) return checks[key as RequirementCheck] === false;
    return false;
  });
}

/** Days the deal has been in its current stage, and whether that exceeds the stage's limit. */
export function staleness(stageEnteredAt: Date | string, maxDaysInStage: number | null, stageType: string, now = new Date()): { days: number; stale: boolean } {
  const days = Math.floor((now.getTime() - new Date(stageEnteredAt).getTime()) / 86_400_000);
  return { days, stale: stageType === "OPEN" && maxDaysInStage !== null && days > maxDaysInStage };
}
