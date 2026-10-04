/**
 * Duplicate matching for shared customers (prompt 03 §4) – pure functions (unit-tested).
 * Rules: same phone, same email, same RC number (exact) or fuzzy name + same city.
 */

const LEGAL_SUFFIXES = /\b(limited|ltd|plc|nigeria|nig|company|co|inc|llc|enterprises?|ventures?|and|&)\b/g;

/** "Acme Logistics Ltd." → "acme logistics" */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s&]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Similar names: equal after normalisation, or within a small edit distance (≤ 15 % of length, max 2). */
export function namesSimilar(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const limit = Math.min(2, Math.floor(Math.max(x.length, y.length) * 0.15));
  return limit > 0 && levenshtein(x, y) <= limit;
}

export interface MatchCandidate {
  id: string;
  name: string;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  rcNumber?: string | null;
}

export type MatchReason = "phone" | "email" | "rcNumber" | "name+city";

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Why two customers look like the same one (empty = no match). */
export function matchReasons(a: Omit<MatchCandidate, "id">, b: Omit<MatchCandidate, "id">): MatchReason[] {
  const reasons: MatchReason[] = [];
  if (eq(a.phone, b.phone)) reasons.push("phone");
  if (eq(a.email, b.email)) reasons.push("email");
  if (eq(a.rcNumber, b.rcNumber)) reasons.push("rcNumber");
  if (eq(a.city, b.city) && namesSimilar(a.name, b.name)) reasons.push("name+city");
  return reasons;
}

/** Groups candidates into duplicate clusters (union-find over pairwise matches). */
export function clusterDuplicates<T extends MatchCandidate>(items: T[]): Array<{ members: T[]; reasons: MatchReason[] }> {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const reasonsByRoot = new Map<string, Set<MatchReason>>();
  const pending: Array<[string, MatchReason[]]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = matchReasons(items[i]!, items[j]!);
      if (r.length) {
        parent.set(find(items[i]!.id), find(items[j]!.id));
        pending.push([items[i]!.id, r]);
      }
    }
  }
  for (const [id, r] of pending) {
    const root = find(id);
    const set = reasonsByRoot.get(root) ?? new Set();
    r.forEach((x) => set.add(x));
    reasonsByRoot.set(root, set);
  }
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const root = find(item.id);
    if (!reasonsByRoot.has(root)) continue;
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  return [...groups.entries()].map(([root, members]) => ({ members, reasons: [...reasonsByRoot.get(root)!] }));
}
