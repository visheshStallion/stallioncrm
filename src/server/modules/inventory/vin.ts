/**
 * VIN validation (ISO 3779 structure + the check digit of position 9 as defined for North America and used by
 * most manufacturers). Pure – also used by the seed to generate fictitious VINs that pass validation.
 */
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export const normalizeVin = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");

/** The check digit (0–9 or X) for the 17 characters; position 9 itself is ignored. */
export function vinCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i]!;
    const value = c >= "0" && c <= "9" ? Number(c) : (TRANSLITERATION[c] ?? 0);
    sum += value * WEIGHTS[i]!;
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

/** null when valid, otherwise what is wrong. */
export function vinProblem(raw: string): string | null {
  const vin = normalizeVin(raw);
  if (vin.length !== 17) return "A VIN has 17 characters";
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return "A VIN uses letters and digits without I, O and Q";
  if (vinCheckDigit(vin) !== vin[8]) return "The VIN check digit does not match – check for a typing error";
  return null;
}

export const isValidVin = (raw: string) => vinProblem(raw) === null;

/** A syntactically valid, fictitious VIN from a 16-character body (positions 1–8 and 10–17). */
export function makeVin(body16: string): string {
  const clean = normalizeVin(body16).replace(/[IOQ]/g, "X").padEnd(16, "0").slice(0, 16);
  const draft = `${clean.slice(0, 8)}0${clean.slice(8)}`;
  return `${clean.slice(0, 8)}${vinCheckDigit(draft)}${clean.slice(8)}`;
}

/** What sales executives see before a unit is reserved for their deal: the last six characters only. */
export const maskVin = (vin: string) => (vin.length > 6 ? `${"•".repeat(vin.length - 6)}${vin.slice(-6)}` : vin);
