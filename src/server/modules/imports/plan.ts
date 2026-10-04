/**
 * Import planning (prompt 12) – pure functions, unit-tested, no database access.
 *
 *   file rows + column mapping + value mapping + lookups  →  one PlanRow per data row:
 *   the values to write, the brand it resolves to, the action (create / update / skip) and its warnings / errors.
 *
 * The same plan is shown as the dry-run report and executed by the background job, so what the user approved
 * is exactly what gets written.
 */
import { excelSerialToDate } from "@/lib/xlsx-read";

export type ImportModuleKey = "leads" | "accounts" | "contacts" | "deals" | "products" | "priceBooks" | "activities";
export type FieldKind = "text" | "number" | "date" | "enum" | "boolean" | "email" | "phone" | "brand" | "region" | "user" | "stage" | "product";

export interface ImportField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** header names that map to this field automatically (lower-case; includes the Zoho export names) */
  aliases: string[];
  options?: string[];
}

export interface ImportModule {
  key: ImportModuleKey;
  label: string;
  /** brand-owned modules need brand + region on every row */
  branded: "owned" | "tagged" | "none";
  fields: ImportField[];
  /** fields that identify an existing record (first non-empty one is used; within the brand when branded) */
  dedupeKeys: string[];
}

const brand: ImportField = { key: "brand", label: "Brand", kind: "brand", required: true, aliases: ["brand", "company", "company code", "company_code", "brand code", "make"] };
const region: ImportField = { key: "region", label: "Region", kind: "region", required: true, aliases: ["region", "branch", "location", "territory"] };
const owner: ImportField = { key: "owner", label: "Owner (email)", kind: "user", aliases: ["owner", "owner email", "lead owner", "deal owner", "account owner", "contact owner", "sales exec", "assigned to"] };
const phone = (key: string, label: string, aliases: string[]): ImportField => ({ key, label, kind: "phone", aliases });
const text = (key: string, label: string, aliases: string[] = [], required = false): ImportField => ({ key, label, kind: "text", aliases: [key.toLowerCase(), label.toLowerCase(), ...aliases], required });

export const IMPORT_MODULES: ImportModule[] = [
  {
    key: "leads",
    label: "Leads",
    branded: "owned",
    dedupeKeys: ["mobile", "email"],
    fields: [
      text("firstName", "First name", ["first name"]),
      text("lastName", "Last name", ["last name", "name", "full name", "lead name"], true),
      phone("mobile", "Mobile", ["mobile", "phone", "mobile phone", "phone number"]),
      { key: "email", label: "Email", kind: "email", aliases: ["email", "email address", "e-mail"] },
      text("city", "City"),
      { key: "source", label: "Lead source", kind: "enum", aliases: ["source", "lead source"], options: ["WALK_IN", "WEBSITE", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "REFERRAL", "FLEET_CORPORATE", "EVENT", "PHONE"] },
      { key: "status", label: "Status", kind: "enum", aliases: ["status", "lead status"], options: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"] },
      { key: "rating", label: "Rating", kind: "enum", aliases: ["rating"], options: ["HOT", "WARM", "COLD"] },
      { key: "model", label: "Model of interest", kind: "product", aliases: ["model", "model of interest", "product", "vehicle"] },
      { key: "budget", label: "Budget", kind: "number", aliases: ["budget", "annual revenue"] },
      brand,
      region,
      owner,
    ],
  },
  {
    key: "accounts",
    label: "Accounts",
    branded: "none",
    dedupeKeys: ["name"],
    fields: [
      text("name", "Account name", ["account name", "company name", "customer"], true),
      { key: "type", label: "Type", kind: "enum", aliases: ["type", "account type"], options: ["INDIVIDUAL", "COMPANY"] },
      phone("phone", "Phone", ["phone", "telephone"]),
      { key: "email", label: "Email", kind: "email", aliases: ["email"] },
      text("industry", "Industry"),
      text("city", "City", ["billing city"]),
      text("state", "State", ["billing state"]),
      text("address", "Address", ["billing street", "street"]),
      text("website", "Website"),
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    branded: "none",
    dedupeKeys: ["mobile", "email"],
    fields: [
      text("firstName", "First name", ["first name"]),
      text("lastName", "Last name", ["last name", "name", "contact name"], true),
      phone("mobile", "Mobile", ["mobile", "phone"]),
      phone("altPhone", "Other phone", ["other phone", "home phone"]),
      { key: "email", label: "Email", kind: "email", aliases: ["email"] },
      text("accountName", "Account name", ["account name", "account", "company"]),
      text("city", "City", ["mailing city"]),
      text("address", "Address", ["mailing street"]),
    ],
  },
  {
    key: "deals",
    label: "Deals",
    branded: "owned",
    dedupeKeys: ["name"],
    fields: [
      text("name", "Deal name", ["deal name", "potential name", "opportunity name"], true),
      { key: "stage", label: "Stage", kind: "stage", aliases: ["stage", "sales stage", "deal stage"] },
      { key: "amount", label: "Amount", kind: "number", aliases: ["amount", "value", "deal value"] },
      { key: "closeDate", label: "Expected close", kind: "date", aliases: ["closing date", "close date", "expected close", "expected close date"] },
      text("accountName", "Account name", ["account name", "account", "customer"]),
      { key: "contactEmail", label: "Contact email", kind: "email", aliases: ["contact email", "email"] },
      { key: "model", label: "Model", kind: "product", aliases: ["model", "product", "vehicle"] },
      { key: "quantity", label: "Quantity", kind: "number", aliases: ["quantity", "units", "qty"] },
      { key: "paymentType", label: "Payment type", kind: "enum", aliases: ["payment type", "payment"], options: ["CASH", "BANK_FINANCE", "LEASE", "FLEET"] },
      text("lossReason", "Loss reason", ["reason for loss", "loss reason"]),
      brand,
      region,
      owner,
    ],
  },
  {
    key: "products",
    label: "Products",
    branded: "tagged",
    dedupeKeys: ["code"],
    fields: [
      text("code", "Product code", ["product code", "sku", "code"], true),
      text("model", "Model", ["model", "product name", "name"], true),
      text("variant", "Variant", ["variant", "trim"]),
      { key: "category", label: "Category", kind: "enum", aliases: ["category", "product category"], options: ["VEHICLE", "ACCESSORY", "SERVICE", "PART"] },
      { key: "modelYear", label: "Model year", kind: "number", aliases: ["model year", "year"] },
      { key: "listPrice", label: "List price", kind: "number", aliases: ["list price", "unit price", "price"] },
      text("description", "Description"),
      brand,
    ],
  },
  {
    key: "priceBooks",
    label: "Price Books",
    branded: "tagged",
    dedupeKeys: ["productCode"],
    fields: [
      text("priceBook", "Price book name", ["price book", "price book name", "pricebook"], true),
      text("productCode", "Product code", ["product code", "sku", "code"], true),
      { key: "price", label: "Price", kind: "number", required: true, aliases: ["price", "list price", "unit price"] },
      { key: "maxDiscountPct", label: "Max discount %", kind: "number", aliases: ["max discount", "max discount %", "discount"] },
      brand,
    ],
  },
  {
    key: "activities",
    label: "Activities",
    branded: "none",
    dedupeKeys: [],
    fields: [
      text("subject", "Subject", ["subject", "task subject", "title"], true),
      { key: "type", label: "Type", kind: "enum", aliases: ["type", "activity type"], options: ["TASK", "CALL", "MEETING"] },
      { key: "dueAt", label: "Due / start", kind: "date", aliases: ["due date", "due", "start", "start datetime", "from"] },
      { key: "status", label: "Status", kind: "enum", aliases: ["status"], options: ["OPEN", "COMPLETED"] },
      text("description", "Description", ["description", "notes"]),
      text("dealName", "Related deal (name)", ["deal name", "related to", "potential name", "what"]),
      phone("leadMobile", "Related lead (mobile)", ["lead mobile", "contact mobile"]),
      { ...brand, required: false },
      owner,
    ],
  },
];

export const importModule = (key: string) => IMPORT_MODULES.find((m) => m.key === key);

/** Zoho CRM stage names → pipeline stage keys (BUSINESS_CONTEXT §8). Extended / overridden by the value mapping. */
export const ZOHO_STAGE_MAP: Record<string, string> = {
  qualification: "ENQUIRY",
  "needs analysis": "ENQUIRY",
  "value proposition": "TEST_DRIVE",
  "identify decision makers": "TEST_DRIVE",
  "proposal/price quote": "QUOTATION",
  "negotiation/review": "BOOKING",
  "closed won": "CLOSED_WON",
  "closed lost": "CLOSED_LOST",
  "closed-lost to competition": "CLOSED_LOST",
};

export type DedupeMode = "skip" | "update" | "create";

export interface ImportMapping {
  /** file header → field key ("" = ignore the column) */
  columns: Record<string, string>;
  /** field key → { value in the file (lower-case) → our value } */
  values: Record<string, Record<string, string>>;
  dedupe: DedupeMode;
  /** used when the file has no brand / region column */
  defaultBrand?: string | null;
  defaultRegion?: string | null;
}

export interface ImportLookups {
  /** brand code / alias / name (upper-case) → brand code */
  brandAliases: Record<string, string>;
  /** brand code → { id, status } */
  brands: Record<string, { id: string; status: string }>;
  /** brand codes the importer may write to (administrators: all) */
  allowedBrands: Set<string>;
  /** region name (lower-case) → id */
  regions: Record<string, string>;
  /** user email (lower-case) → id */
  users: Record<string, string>;
  /** brand code → stage key / name (upper-case) → stage id */
  stages: Record<string, Record<string, string>>;
  /** brand code → product code or name (upper-case) → product id */
  products: Record<string, Record<string, string>>;
  /** dedupe index: "<brand code or *>|<field>|<normalised value>" → existing record id */
  existing: Record<string, string>;
}

export interface PlanRow {
  line: number;
  /** resolved values by field key (ids for brand / region / user / stage / product in `ids`) */
  values: Record<string, string | number | boolean | null>;
  ids: { brandId?: string; regionId?: string; ownerId?: string; stageId?: string; productId?: string };
  brand: string | null;
  action: "create" | "update" | "skip";
  existingId: string | null;
  warnings: string[];
  errors: string[];
}

export interface ImportPlan {
  rows: PlanRow[];
  summary: { total: number; create: number; update: number; skip: number; warnings: number; errors: number; byBrand: Record<string, number> };
  unmappedColumns: string[];
  missingRequired: string[];
}

export const MAX_IMPORT_ROWS = 5000;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Proposes a column mapping from the file's header row (exact alias match, case-insensitive). */
export function autoMapColumns(mod: ImportModule, headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of headers) {
    const key = norm(h);
    const field = mod.fields.find((f) => !used.has(f.key) && (f.key.toLowerCase() === key.replace(/ /g, "") || f.aliases.includes(key)));
    out[h] = field?.key ?? "";
    if (field) used.add(field.key);
  }
  return out;
}

function normalisePhone(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (!plus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("234") && digits.length >= 12) digits = `${digits}`;
    else digits = `234${digits.replace(/^0/, "")}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

function parseDate(raw: string): string | null {
  const v = raw.trim();
  const serial = excelSerialToDate(v);
  if (serial) return serial;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [null, null, null];
  if (!y) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  }
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 ? date.toISOString().slice(0, 10) : null;
}

const enumValue = (raw: string, options: string[]) => {
  const key = raw.trim().toUpperCase().replace(/[\s/-]+/g, "_");
  return options.find((o) => o === key) ?? options.find((o) => o.replace(/_/g, "") === key.replace(/_/g, "")) ?? null;
};

/**
 * Builds the plan. `rows[0]` is the header row. Brand Managers may only import into their own brands: a row
 * whose brand resolves outside `lookups.allowedBrands` is an ERROR (never silently re-mapped).
 */
export function planImport(mod: ImportModule, rows: string[][], mapping: ImportMapping, lookups: ImportLookups): ImportPlan {
  const [header = [], ...body] = rows;
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`A file can have at most ${MAX_IMPORT_ROWS} rows`);
  const fieldOf = header.map((h) => mod.fields.find((f) => f.key === mapping.columns[h]) ?? null);
  const mapped = new Set(fieldOf.filter(Boolean).map((f) => f!.key));
  const hasDefault = (k: string) => (k === "brand" && !!mapping.defaultBrand) || (k === "region" && !!mapping.defaultRegion);
  const missingRequired = mod.fields.filter((f) => f.required && !mapped.has(f.key) && !hasDefault(f.key)).map((f) => f.label);
  const seen = new Map<string, number>();
  const plan: PlanRow[] = [];

  body.forEach((cells, index) => {
    const row: PlanRow = { line: index + 2, values: {}, ids: {}, brand: null, action: "create", existingId: null, warnings: [], errors: [] };
    const raw: Record<string, string> = {};
    fieldOf.forEach((f, i) => {
      const v = (cells[i] ?? "").trim();
      if (f && v) raw[f.key] = mapping.values[f.key]?.[norm(v)] ?? v;
    });
    if (!raw.brand && mapping.defaultBrand && mod.fields.some((f) => f.key === "brand")) raw.brand = mapping.defaultBrand;
    if (!raw.region && mapping.defaultRegion && mod.fields.some((f) => f.key === "region")) raw.region = mapping.defaultRegion;

    // brand first: stages and products depend on it
    if (raw.brand) {
      const code = lookups.brandAliases[raw.brand.trim().toUpperCase()];
      const b = code ? lookups.brands[code] : undefined;
      if (!code || !b) row.errors.push(`Unknown brand "${raw.brand}"`);
      else if (b.status === "INACTIVE") row.errors.push(`Brand ${code} is inactive`);
      else if (!lookups.allowedBrands.has(code)) row.errors.push(`You cannot import into brand ${code}`);
      else {
        row.brand = code;
        row.ids.brandId = b.id;
      }
    }

    for (const f of mod.fields) {
      const v = raw[f.key];
      if (!v) {
        if (f.required && f.kind !== "brand") row.errors.push(`${f.label} is missing`);
        else if (f.required && !raw.brand) row.errors.push("Brand is missing");
        continue;
      }
      switch (f.kind) {
        case "brand":
          break;
        case "region": {
          const id = lookups.regions[norm(v)];
          if (id) row.ids.regionId = id;
          else row.errors.push(`Unknown region "${v}"`);
          break;
        }
        case "user": {
          const id = lookups.users[norm(v)];
          if (id) row.ids.ownerId = id;
          else row.warnings.push(`Owner "${v}" not found – the importer becomes the owner`);
          break;
        }
        case "stage": {
          const key = (ZOHO_STAGE_MAP[norm(v)] ?? v).trim().toUpperCase().replace(/[\s-]+/g, "_");
          const id = row.brand ? (lookups.stages[row.brand]?.[key] ?? lookups.stages[row.brand]?.[v.trim().toUpperCase()]) : undefined;
          if (id) {
            row.ids.stageId = id;
            row.values.stage = key;
          } else if (row.brand) row.errors.push(`Stage "${v}" is not mapped to a stage of ${row.brand}`);
          break;
        }
        case "product": {
          const id = row.brand ? lookups.products[row.brand]?.[v.trim().toUpperCase()] : undefined;
          if (id) row.ids.productId = id;
          else row.warnings.push(`Model "${v}" is not a product of ${row.brand ?? "the brand"} – left empty`);
          break;
        }
        case "number": {
          const n = Number(v.replace(/[₦,\s]|NGN/gi, ""));
          if (Number.isFinite(n)) row.values[f.key] = n;
          else row.errors.push(`${f.label}: "${v}" is not a number`);
          break;
        }
        case "date": {
          const d = parseDate(v);
          if (d) row.values[f.key] = d;
          else row.errors.push(`${f.label}: "${v}" is not a date`);
          break;
        }
        case "enum": {
          const e = enumValue(v, f.options ?? []);
          if (e) row.values[f.key] = e;
          else row.errors.push(`${f.label}: "${v}" is not one of ${f.options?.join(", ")} – add a value mapping`);
          break;
        }
        case "boolean":
          row.values[f.key] = /^(1|true|yes|y)$/i.test(v);
          break;
        case "email":
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) row.values[f.key] = v.toLowerCase();
          else row.errors.push(`${f.label}: "${v}" is not an email address`);
          break;
        case "phone": {
          const p = normalisePhone(v);
          if (p) row.values[f.key] = p;
          else row.errors.push(`${f.label}: "${v}" is not a phone number`);
          break;
        }
        default:
          row.values[f.key] = v.slice(0, 2000);
      }
    }
    if (mod.key === "leads" && !row.values.mobile && !row.values.email) row.errors.push("Mobile or email is required");
    if (mod.key === "activities" && !row.values.dealName && !row.values.leadMobile) row.errors.push("An activity needs a related deal (name) or lead (mobile)");

    // dedupe: against existing records and against earlier rows of the same file
    const scope = mod.branded === "none" ? "*" : (row.brand ?? "?");
    for (const key of mod.dedupeKeys) {
      const v = row.values[key];
      if (v === undefined || v === null || v === "") continue;
      const k = `${scope}|${key}|${String(v).toLowerCase()}${mod.key === "priceBooks" ? `|${String(row.values.priceBook ?? "").toLowerCase()}` : ""}`;
      const first = seen.get(k);
      if (first !== undefined) {
        row.warnings.push(`Same ${key} as line ${first}`);
        if (mapping.dedupe !== "create") row.action = "skip";
      } else seen.set(k, row.line);
      const existing = lookups.existing[k];
      if (existing && row.action !== "skip") {
        row.existingId = existing;
        if (mapping.dedupe === "skip") {
          row.action = "skip";
          row.warnings.push(`Already exists (same ${key}) – skipped`);
        } else if (mapping.dedupe === "update") row.action = "update";
        else row.warnings.push(`A record with the same ${key} already exists – a duplicate will be created`);
      }
      break;
    }
    if (row.errors.length) row.action = "skip";
    plan.push(row);
  });

  const ok = plan.filter((r) => r.errors.length === 0);
  const byBrand: Record<string, number> = {};
  for (const r of ok) if (r.action !== "skip") byBrand[r.brand ?? "–"] = (byBrand[r.brand ?? "–"] ?? 0) + 1;
  return {
    rows: plan,
    summary: {
      total: plan.length,
      create: ok.filter((r) => r.action === "create").length,
      update: ok.filter((r) => r.action === "update").length,
      skip: plan.filter((r) => r.action === "skip" && r.errors.length === 0).length,
      warnings: plan.filter((r) => r.warnings.length > 0).length,
      errors: plan.length - ok.length,
      byBrand,
    },
    unmappedColumns: header.filter((h) => !mapping.columns[h]),
    missingRequired,
  };
}

/** The dedupe index key of an existing record (must match the keys built in planImport). */
export const existingKey = (brandCode: string | null, field: string, value: string, priceBook?: string) => `${brandCode ?? "*"}|${field}|${value.toLowerCase()}${priceBook !== undefined ? `|${priceBook.toLowerCase()}` : ""}`;
