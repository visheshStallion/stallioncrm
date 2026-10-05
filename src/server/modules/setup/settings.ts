/**
 * Organisation settings (table OrgSetting): one definition per key – schema, defaults, the Setup function that owns
 * it and the form fields. Pure (no database), so the policies can be unit-tested.
 *
 * `fourEyes: true` → a change is an authentication-policy change: it is not applied when saved but becomes a request
 * that a second Super Admin approves (prompt 19 §1).
 */
import { z } from "zod";

export type SettingField =
  | { name: string; label: string; type: "text" | "textarea" | "email"; hint?: string }
  | { name: string; label: string; type: "number"; min: number; max: number; hint?: string }
  | { name: string; label: string; type: "checkbox"; hint?: string }
  | { name: string; label: string; type: "select"; options: Array<{ value: string; label: string }>; hint?: string }
  /** one "CODE = rate" pair per line */
  | { name: string; label: string; type: "rates"; hint?: string }
  /** tick list filled by the page (e.g. profiles) */
  | { name: string; label: string; type: "multi"; source: "profiles"; hint?: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const company = z.object({
  name: z.string().trim().min(1).max(120).default("Stallion Group"),
  address: z.string().trim().max(500).default(""),
  primaryContact: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.string().trim().email()]).default(""),
  phone: z.string().trim().max(40).default(""),
  timeZone: z.string().trim().min(1).max(60).default("Africa/Lagos"),
  locale: z.string().trim().min(2).max(20).default("en-NG"),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).default("DD/MM/YYYY"),
});

const fiscalYear = z.object({
  startMonth: z.coerce.number().int().min(1).max(12).default(1),
});

const currencies = z.object({
  home: z.string().trim().length(3).toUpperCase().default("NGN"),
  /** units of the home currency for one unit of the extra currency */
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.coerce.number().positive().max(1e9)).default({}),
  rounding: z.coerce.number().int().min(0).max(4).default(2),
});

export const passwordPolicySchema = z.object({
  minLength: z.coerce.number().int().min(8).max(64).default(10),
  requireUpper: z.coerce.boolean().default(false),
  requireLower: z.coerce.boolean().default(false),
  requireDigit: z.coerce.boolean().default(false),
  requireSymbol: z.coerce.boolean().default(false),
  /** days until a password must be changed; 0 = never */
  expiryDays: z.coerce.number().int().min(0).max(730).default(0),
  /** how many earlier passwords may not be reused; 0 = no check */
  history: z.coerce.number().int().min(0).max(10).default(0),
  lockoutAttempts: z.coerce.number().int().min(3).max(20).default(5),
  lockoutMinutes: z.coerce.number().int().min(1).max(1440).default(15),
});
export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

const mfaPolicy = z.object({
  /** profiles whose users must switch on two-step sign-in before they can work */
  requiredProfileIds: z.array(z.string()).max(100).default([]),
});

const sessionPolicy = z.object({
  /** a sign-in is valid for at most this many hours */
  maxHours: z.coerce.number().int().min(1).max(12).default(12),
});

const recycleBin = z.object({
  /** deleted records older than this are purged by the scheduler; 0 = keep until purged by hand */
  purgeAfterDays: z.coerce.number().int().min(0).max(3650).default(0),
});

export const SETTINGS = {
  company: {
    entry: "company-details",
    title: "Company details",
    schema: company,
    fourEyes: false,
    fields: [
      { name: "name", label: "Group name", type: "text" },
      { name: "address", label: "Address", type: "textarea" },
      { name: "primaryContact", label: "Primary contact", type: "text" },
      { name: "email", label: "Contact e-mail", type: "email" },
      { name: "phone", label: "Contact phone", type: "text" },
      { name: "timeZone", label: "Default time zone", type: "text", hint: "IANA name, e.g. Africa/Lagos" },
      { name: "locale", label: "Locale", type: "text", hint: "e.g. en-NG" },
      { name: "dateFormat", label: "Default date format", type: "select", options: [{ value: "DD/MM/YYYY", label: "DD/MM/YYYY" }, { value: "MM/DD/YYYY", label: "MM/DD/YYYY" }, { value: "YYYY-MM-DD", label: "YYYY-MM-DD" }] },
    ] as SettingField[],
  },
  fiscalYear: {
    entry: "fiscal-year",
    title: "Fiscal year",
    schema: fiscalYear,
    fourEyes: false,
    fields: [{ name: "startMonth", label: "First month of the financial year", type: "select", options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })), hint: "Quarters are three months each, counted from this month" }] as SettingField[],
  },
  currencies: {
    entry: "currencies",
    title: "Currencies",
    schema: currencies,
    fourEyes: false,
    fields: [
      { name: "home", label: "Home currency", type: "text", hint: "ISO code, three letters" },
      { name: "rates", label: "Extra currencies and exchange rates", type: "rates", hint: "One per line: USD = 1550.00 (home currency for one unit)" },
      { name: "rounding", label: "Decimal places", type: "number", min: 0, max: 4 },
    ] as SettingField[],
  },
  passwordPolicy: {
    entry: "password-policy",
    title: "Password policy",
    schema: passwordPolicySchema,
    fourEyes: true,
    fields: [
      { name: "minLength", label: "Minimum length", type: "number", min: 8, max: 64 },
      { name: "requireUpper", label: "Require an upper-case letter", type: "checkbox" },
      { name: "requireLower", label: "Require a lower-case letter", type: "checkbox" },
      { name: "requireDigit", label: "Require a digit", type: "checkbox" },
      { name: "requireSymbol", label: "Require a symbol", type: "checkbox" },
      { name: "expiryDays", label: "Password expires after (days)", type: "number", min: 0, max: 730, hint: "0 = never" },
      { name: "history", label: "Earlier passwords that may not be reused", type: "number", min: 0, max: 10, hint: "0 = no check" },
      { name: "lockoutAttempts", label: "Lock the account after failed attempts", type: "number", min: 3, max: 20 },
      { name: "lockoutMinutes", label: "Lock duration (minutes)", type: "number", min: 1, max: 1440 },
    ] as SettingField[],
  },
  mfaPolicy: {
    entry: "mfa",
    title: "Multi-factor authentication",
    schema: mfaPolicy,
    fourEyes: true,
    fields: [{ name: "requiredProfileIds", label: "Profiles that must use two-step sign-in", type: "multi", source: "profiles", hint: "Users of these profiles are sent to Sign-in security until they have switched it on" }] as SettingField[],
  },
  sessionPolicy: {
    entry: "session-settings",
    title: "Session settings",
    schema: sessionPolicy,
    fourEyes: true,
    fields: [{ name: "maxHours", label: "Sign in again after (hours)", type: "number", min: 1, max: 12 }] as SettingField[],
  },
  recycleBin: {
    entry: "recycle-bin",
    title: "Recycle bin",
    schema: recycleBin,
    fourEyes: false,
    fields: [{ name: "purgeAfterDays", label: "Purge deleted records automatically after (days)", type: "number", min: 0, max: 3650, hint: "0 = only when a Super Admin purges them" }] as SettingField[],
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

/** The stored value completed with defaults; an invalid stored value falls back to the defaults. */
export function resolveSetting<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
  const schema = SETTINGS[key].schema as z.ZodTypeAny;
  const parsed = schema.safeParse(stored ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as SettingValue<K>;
}

/** Form values → the setting's shape (unknown keys dropped, types coerced). Throws ZodError on invalid input. */
export function parseSettingForm<K extends SettingKey>(key: K, fd: FormData): SettingValue<K> {
  const raw: Record<string, unknown> = {};
  for (const field of SETTINGS[key].fields) {
    if (field.type === "checkbox") raw[field.name] = fd.get(field.name) === "on" || fd.get(field.name) === "true";
    else if (field.type === "multi") raw[field.name] = fd.getAll(field.name).map(String);
    else if (field.type === "rates") raw[field.name] = parseRates(String(fd.get(field.name) ?? ""));
    else raw[field.name] = String(fd.get(field.name) ?? "").trim();
  }
  return (SETTINGS[key].schema as z.ZodTypeAny).parse(raw) as SettingValue<K>;
}

export function parseRates(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]{3})\s*[=:]\s*([0-9][0-9,]*\.?[0-9]*)\s*$/.exec(line);
    if (m) out[m[1]!.toUpperCase()] = m[2]!.replace(/,/g, "");
    else if (line.trim()) throw new z.ZodError([{ code: "custom", path: ["rates"], message: `"${line.trim()}" is not "CODE = rate"` }]);
  }
  return out;
}

export const formatRates = (rates: Record<string, number>) =>
  Object.entries(rates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, rate]) => `${code} = ${rate}`)
    .join("\n");

/** Why a password breaks the policy, or null when it is acceptable. */
export function passwordProblem(policy: PasswordPolicy, password: string): string | null {
  if (password.length < policy.minLength) return `at least ${policy.minLength} characters`;
  if (password.length > 200) return "at most 200 characters";
  if (policy.requireUpper && !/[A-Z]/.test(password)) return "an upper-case letter is required";
  if (policy.requireLower && !/[a-z]/.test(password)) return "a lower-case letter is required";
  if (policy.requireDigit && !/[0-9]/.test(password)) return "a digit is required";
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) return "a symbol is required";
  return null;
}

export function passwordExpired(policy: PasswordPolicy, changedAt: Date | null, now = new Date()): boolean {
  if (!policy.expiryDays || !changedAt) return false;
  return now.getTime() - changedAt.getTime() > policy.expiryDays * 86_400_000;
}

/** The quarter (1–4) and fiscal year label of a date for a fiscal year starting in `startMonth` (1–12). */
export function fiscalPeriod(date: Date, startMonth: number): { year: number; quarter: number } {
  const m = date.getUTCMonth() + 1;
  const offset = (m - startMonth + 12) % 12;
  // the fiscal year is named after the calendar year in which it ends (same year when it starts in January)
  const year = startMonth === 1 ? date.getUTCFullYear() : m >= startMonth ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  return { year, quarter: Math.floor(offset / 3) + 1 };
}
