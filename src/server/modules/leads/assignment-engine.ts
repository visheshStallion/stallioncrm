/**
 * Lead assignment rule engine – pure functions (unit-tested). The service (assignment.ts) loads rules,
 * candidates and pointers from the database and persists the new round-robin pointer.
 *
 * Rules are evaluated in `position` order; the first ACTIVE rule whose criteria all match wins.
 * Criteria fields that are null match anything.
 */

export type AssignmentActionKind = "ROUND_ROBIN" | "SPECIFIC_USER" | "TERRITORY_MANAGER";

export interface RuleLike {
  id: string;
  position: number;
  active: boolean;
  brandId: string | null;
  regionId: string | null;
  source: string | null;
  productId: string | null;
  action: AssignmentActionKind;
  userId: string | null;
  rrPointer: number;
}

export interface LeadFacts {
  brandId: string;
  regionId: string;
  source: string;
  modelOfInterestId: string | null;
}

export function ruleMatches(rule: RuleLike, lead: LeadFacts): boolean {
  return (
    rule.active &&
    (rule.brandId === null || rule.brandId === lead.brandId) &&
    (rule.regionId === null || rule.regionId === lead.regionId) &&
    (rule.source === null || rule.source === lead.source) &&
    (rule.productId === null || rule.productId === lead.modelOfInterestId)
  );
}

export function pickRule<R extends RuleLike>(rules: R[], lead: LeadFacts): R | null {
  return [...rules].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).find((r) => ruleMatches(r, lead)) ?? null;
}

export interface Candidate {
  id: string;
  active: boolean;
}

/**
 * Round-robin over active candidates (stable order by id). `pointer` is the rule's persisted counter;
 * returns the chosen user and the counter to store. Inactive users are skipped.
 */
export function roundRobin(candidates: Candidate[], pointer: number): { userId: string | null; nextPointer: number } {
  const active = candidates.filter((c) => c.active).map((c) => c.id).sort();
  if (active.length === 0) return { userId: null, nextPointer: pointer };
  const idx = ((pointer % active.length) + active.length) % active.length;
  return { userId: active[idx]!, nextPointer: pointer + 1 };
}

export interface AssignmentInputs {
  /** Non-manager active members of the lead's Brand–Region territory. */
  territoryMembers: Candidate[];
  territoryManager: Candidate | null;
  brandManager: Candidate | null;
  /** The rule's specific user (for SPECIFIC_USER) with whether they can access the lead's brand/region. */
  specificUser: (Candidate & { hasAccess: boolean }) | null;
}

export interface AssignmentDecision {
  userId: string | null;
  ruleId: string | null;
  nextPointer: number | null;
  via: "rule" | "fallback-round-robin" | "territory-manager" | "brand-manager" | "none";
}

/**
 * Decides the owner. Fallback chain when the rule's action yields nobody (or no rule matches):
 * round-robin among territory members → territory manager → brand manager.
 */
export function decideAssignment(rule: RuleLike | null, inputs: AssignmentInputs, fallbackPointer: number): AssignmentDecision {
  const activeOrNull = (c: Candidate | null) => (c?.active ? c.id : null);

  if (rule) {
    if (rule.action === "ROUND_ROBIN") {
      const rr = roundRobin(inputs.territoryMembers, rule.rrPointer);
      if (rr.userId) return { userId: rr.userId, ruleId: rule.id, nextPointer: rr.nextPointer, via: "rule" };
    } else if (rule.action === "SPECIFIC_USER") {
      const u = inputs.specificUser;
      if (u?.active && u.hasAccess) return { userId: u.id, ruleId: rule.id, nextPointer: null, via: "rule" };
    } else if (rule.action === "TERRITORY_MANAGER") {
      const m = activeOrNull(inputs.territoryManager);
      if (m) return { userId: m, ruleId: rule.id, nextPointer: null, via: "rule" };
    }
  }

  const rr = roundRobin(inputs.territoryMembers, fallbackPointer);
  if (rr.userId) return { userId: rr.userId, ruleId: null, nextPointer: null, via: "fallback-round-robin" };
  const tm = activeOrNull(inputs.territoryManager);
  if (tm) return { userId: tm, ruleId: null, nextPointer: null, via: "territory-manager" };
  const bm = activeOrNull(inputs.brandManager);
  if (bm) return { userId: bm, ruleId: null, nextPointer: null, via: "brand-manager" };
  return { userId: null, ruleId: null, nextPointer: null, via: "none" };
}
