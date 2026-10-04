/**
 * Normalises a phone number to E.164. Nigerian numbers are the default:
 *   08031234521 → +2348031234521 · 8031234521 → +2348031234521 · 2348031234521 → +2348031234521
 *   +44 20 7946 0958 → +442079460958 · 0044… → +44…
 * Returns null when the result is not a plausible E.164 number.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = "234"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (plus) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith(defaultCountryCode) && digits.length >= defaultCountryCode.length + 9) e164 = `+${digits}`;
  else {
    if (digits.startsWith("0")) digits = digits.slice(1);
    e164 = `+${defaultCountryCode}${digits}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
