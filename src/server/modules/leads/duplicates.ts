/**
 * Duplicate check on mobile / email (prompt 02 §3) – pure classification (unit-tested).
 * - Same brand, visible to the user → WARN with details (link to the lead).
 * - Anything else (other brand, or not visible) → INFORM "Customer exists – link instead" WITHOUT details.
 * - Matching shared contacts are offered for linking (customers are shared across brands).
 */

export interface VisibleMatch {
  id: string;
  brandId: string;
  name: string;
  status: string;
  ownerName: string;
}

export interface DuplicateReport {
  sameBrand: Array<Omit<VisibleMatch, "brandId">>;
  existsElsewhere: boolean;
  contacts: Array<{ id: string; name: string; accountName: string | null }>;
}

export function classifyDuplicates(
  brandId: string,
  visible: VisibleMatch[],
  hiddenCount: number,
  contacts: DuplicateReport["contacts"],
): DuplicateReport {
  const sameBrand = visible
    .filter((m) => m.brandId === brandId)
    .map(({ id, name, status, ownerName }) => ({ id, name, status, ownerName }));
  const otherVisible = visible.some((m) => m.brandId !== brandId);
  return { sameBrand, existsElsewhere: otherVisible || hiddenCount > 0, contacts };
}

export function hasDuplicates(r: DuplicateReport): boolean {
  return r.sameBrand.length > 0 || r.existsElsewhere || r.contacts.length > 0;
}
