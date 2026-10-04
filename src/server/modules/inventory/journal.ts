/**
 * Journals of the inventory postings (prompt 16 §5). Pure builders – one balanced entry per event, in the
 * accounts of the brand's own mapping (each brand is a legal entity with its own books).
 *
 *   Receipt (GRN)        Dr Inventory            Cr Goods received not invoiced
 *   Vendor bill          Dr GRNI                 Cr Accounts payable   (difference to the receipt → Purchase price variance)
 *   Landed cost          Dr Inventory            Cr Landed cost clearing
 *   Sale issue           Dr Cost of goods sold   Cr Inventory          (a vehicle at its own landed cost)
 *   Adjustment / write-off  Dr Inventory adjustment  Cr Inventory      (or the reverse for a gain)
 *   Purchase return      Dr Accounts payable     Cr Inventory
 *   Inter-brand transfer  seller: Dr Inter-company receivable  Cr Inventory (+/− gain on transfer)
 *                         buyer:  Dr Inventory                 Cr Inter-company payable
 */
import { round2 } from "./costing";

export const ACCOUNT_KEYS = ["inventory", "grni", "landedCostClearing", "cogs", "adjustment", "ppv", "ap", "fx", "interCompany"] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];
export type AccountMap = Record<AccountKey, string>;

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  inventory: "Inventory asset",
  grni: "Goods received not invoiced",
  landedCostClearing: "Landed cost clearing",
  cogs: "Cost of goods sold",
  adjustment: "Inventory adjustment",
  ppv: "Purchase price variance",
  ap: "Accounts payable",
  fx: "FX gain / loss",
  interCompany: "Inter-company",
};

export const DEFAULT_ACCOUNTS: AccountMap = {
  inventory: "1400 Inventory",
  grni: "2150 Goods received not invoiced",
  landedCostClearing: "2160 Landed cost clearing",
  cogs: "5000 Cost of goods sold",
  adjustment: "5900 Inventory adjustment",
  ppv: "5910 Purchase price variance",
  ap: "2100 Accounts payable",
  fx: "7900 FX gain / loss",
  interCompany: "1900 Inter-company",
};

export function accountMap(stored: unknown): AccountMap {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<AccountKey, unknown>>;
  return Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, typeof s[k] === "string" && (s[k] as string).trim() ? (s[k] as string).trim() : DEFAULT_ACCOUNTS[k]])) as AccountMap;
}

export interface JournalLineDraft {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
}
export interface JournalDraft {
  memo: string;
  lines: JournalLineDraft[];
}

const dr = (account: string, amount: number, memo?: string): JournalLineDraft => ({ account, debit: round2(amount), credit: 0, memo });
const cr = (account: string, amount: number, memo?: string): JournalLineDraft => ({ account, debit: 0, credit: round2(amount), memo });

export function isBalanced(lines: JournalLineDraft[]): boolean {
  return Math.abs(lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;
}

/** Drops zero lines and refuses an entry that does not balance or carries a negative amount. */
function entry(memo: string, lines: JournalLineDraft[]): JournalDraft | null {
  const kept = lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  if (kept.length === 0) return null;
  if (kept.some((l) => l.debit < 0 || l.credit < 0)) throw new Error("Journal amounts cannot be negative");
  if (!isBalanced(kept)) throw new Error(`The journal "${memo}" does not balance`);
  return { memo, lines: kept };
}

export const receiptJournal = (a: AccountMap, number: string, amount: number) => entry(`Goods received ${number}`, [dr(a.inventory, amount), cr(a.grni, amount)]);

/** `received` is what the receipt accrued; a different bill amount goes to purchase price variance. */
export function billJournal(a: AccountMap, number: string, billed: number, received: number) {
  const variance = round2(billed - received);
  return entry(`Vendor bill ${number}`, [dr(a.grni, received), ...(variance > 0 ? [dr(a.ppv, variance)] : variance < 0 ? [cr(a.ppv, -variance)] : []), cr(a.ap, billed)]);
}

export const landedCostJournal = (a: AccountMap, number: string, amount: number) => entry(`Landed cost ${number}`, [dr(a.inventory, amount), cr(a.landedCostClearing, amount)]);

export const saleIssueJournal = (a: AccountMap, reference: string, cost: number) => entry(`Cost of sale ${reference}`, [dr(a.cogs, cost), cr(a.inventory, cost)]);

/** `delta` > 0 increases stock value (count surplus), < 0 decreases it (damage, theft, write-off). */
export function adjustmentJournal(a: AccountMap, number: string, delta: number) {
  return delta >= 0 ? entry(`Inventory adjustment ${number}`, [dr(a.inventory, delta), cr(a.adjustment, delta)]) : entry(`Inventory adjustment ${number}`, [dr(a.adjustment, -delta), cr(a.inventory, -delta)]);
}

export const returnJournal = (a: AccountMap, number: string, cost: number) => entry(`Purchase return ${number}`, [dr(a.ap, cost), cr(a.inventory, cost)]);

/** Selling entity: stock leaves at cost, the receivable is the transfer price, the difference is a gain / loss. */
export function interBrandOutJournal(a: AccountMap, number: string, cost: number, price: number) {
  const gain = round2(price - cost);
  return entry(`Inter-brand transfer out ${number}`, [dr(a.interCompany, price), ...(gain < 0 ? [dr(a.adjustment, -gain, "loss on transfer")] : []), cr(a.inventory, cost), ...(gain > 0 ? [cr(a.adjustment, gain, "gain on transfer")] : [])]);
}

/** Buying entity: stock arrives at the transfer price. */
export const interBrandInJournal = (a: AccountMap, number: string, price: number) => entry(`Inter-brand transfer in ${number}`, [dr(a.inventory, price), cr(a.interCompany, price)]);
