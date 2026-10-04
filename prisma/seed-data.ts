/**
 * FICTITIOUS seed data only – the repository is public (BUSINESS_CONTEXT §12).
 * Names, emails and customers are invented; emails use the reserved `.test` TLD.
 * Real users are imported at runtime through the admin CSV import (prompt 01).
 */

export const SEED_PASSWORD = "Stallion!2026";
export const EMAIL_DOMAIN = "stallioncrm.test";
export const email = (local: string) => `${local}@${EMAIL_DOMAIN}`;

export const REGIONS = ["Lagos", "Abuja", "Port Harcourt", "Ibadan"] as const;
export type RegionName = (typeof REGIONS)[number];

export const ACTIVE_BRANDS = ["HMNL", "SNMNL", "SMGL", "THPL", "ZANL"] as const;
export type ActiveBrand = (typeof ACTIVE_BRANDS)[number];

export const BRANDS: Array<{
  code: string;
  name: string;
  color: string;
  status: "ACTIVE" | "FUTURE";
}> = [
  { code: "HMNL", name: "Hyundai", color: "#1d4ed8", status: "ACTIVE" },
  { code: "SNMNL", name: "Nissan", color: "#be123c", status: "ACTIVE" },
  { code: "SMGL", name: "MG", color: "#047857", status: "ACTIVE" },
  { code: "THPL", name: "THPL", color: "#7c3aed", status: "ACTIVE" },
  { code: "ZANL", name: "ZANL", color: "#b45309", status: "ACTIVE" },
  { code: "BRAND6", name: "Future brand 6", color: "#0e7490", status: "FUTURE" },
  { code: "BRAND7", name: "Future brand 7", color: "#4d7c0f", status: "FUTURE" },
  { code: "BRAND8", name: "Future brand 8", color: "#a21caf", status: "FUTURE" },
  { code: "BRAND9", name: "Future brand 9", color: "#475569", status: "FUTURE" },
  { code: "BRAND10", name: "Future brand 10", color: "#9f1239", status: "FUTURE" },
];

/** Legacy rep-file codes → brand (BUSINESS_CONTEXT §2). Editable by admins. */
export const BRAND_ALIASES: Array<{ alias: string; brand: string; note?: string }> = [
  { alias: "HMNL", brand: "HMNL" },
  { alias: "SNMN", brand: "SNMNL", note: "Nissan" },
  { alias: "SNML", brand: "SNMNL", note: "Nissan – second code, confirm" },
  { alias: "MG", brand: "SMGL" },
  { alias: "SML", brand: "SMGL", note: "2 reps only – confirm" },
  { alias: "THP", brand: "THPL" },
  { alias: "ZAHAV", brand: "ZANL", note: "confirm" },
];

export const ROLES = {
  MD: "Managing Director",
  HOS: "Head of Sales",
  BM: "Brand Manager",
  LAGOS_EXEC: "Lagos Sales Exec",
  RSM: "Regional Sales Manager",
  REGIONAL_EXEC: "Regional Sales Exec",
  ADMIN: "CRM Administrator",
} as const;

/** Role → parent role (reporting line, §6). */
export const ROLE_PARENTS: Record<string, string | null> = {
  [ROLES.MD]: null,
  [ROLES.HOS]: ROLES.MD,
  [ROLES.BM]: ROLES.HOS,
  [ROLES.LAGOS_EXEC]: ROLES.BM,
  [ROLES.RSM]: ROLES.HOS,
  [ROLES.REGIONAL_EXEC]: ROLES.RSM,
  [ROLES.ADMIN]: null,
};

export const PROFILES = {
  MANAGEMENT: "Management",
  ADMIN: "Administrator",
  BM: "Brand Manager",
  RSM: "RSM",
  EXEC: "Sales Exec",
} as const;

const TX_MODULES = ["leads", "deals", "quotes", "salesOrders", "invoices", "activities", "cases"];
const CUSTOMER_MODULES = ["accounts", "contacts"];
const CATALOGUE_MODULES = ["products", "priceBooks"];
const ANALYTICS_MODULES = ["reports", "dashboards", "forecasts"];
// Capability modules: "export" = may export data (matrix row "Export data"), "import" = data import, "admin" = setup.
const EXPORT_ACCESS = { export: { read: true, export: true } };

type Perm = Partial<Record<"read" | "create" | "edit" | "delete" | "export" | "massUpdate" | "approve" | "massEmail", boolean>>;
const grant = (modules: string[], perm: Perm) =>
  Object.fromEntries(modules.map((m) => [m, perm]));

const SALES_WRITE: Perm = { read: true, create: true, edit: true };
const MANAGER_WRITE: Perm = { ...SALES_WRITE, export: true, massUpdate: true, approve: true };

/** Permission matrix (BUSINESS_CONTEXT §7). Brand is never encoded in a profile. */
export const PROFILE_DEFS: Array<{
  name: string;
  scope: "ALL" | "TERRITORY";
  permissions: Record<string, Perm>;
  fieldPermissions: Record<string, Record<string, string>>;
}> = (() => {
  // Customer masking follows the field tiers (src/server/access/customer-tier.ts), not profile field permissions.
  const basicCustomerFields = {};
  return [
    {
      name: PROFILES.EXEC,
      scope: "TERRITORY",
      permissions: {
        ...grant(TX_MODULES, SALES_WRITE),
        ...grant(CUSTOMER_MODULES, SALES_WRITE),
        ...grant(CATALOGUE_MODULES, { read: true }),
        ...grant(ANALYTICS_MODULES, { read: true }),
        reports: { read: true, create: true, edit: true },
      },
      fieldPermissions: basicCustomerFields,
    },
    {
      name: PROFILES.BM,
      scope: "TERRITORY",
      permissions: {
        ...grant(TX_MODULES, MANAGER_WRITE),
        ...grant(CUSTOMER_MODULES, { ...SALES_WRITE, export: true, massUpdate: true }),
        // Brand Managers manage their own brand's catalogue (enforced per brand by canManageBrandData).
        ...grant(CATALOGUE_MODULES, { read: true, create: true, edit: true, export: true }),
        ...grant(ANALYTICS_MODULES, { read: true, export: true }),
        reports: { read: true, create: true, edit: true, export: true },
        campaigns: { read: true, create: true, edit: true, massEmail: true },
        ...EXPORT_ACCESS,
        // sets targets for the own brand (enforced per brand in the forecasts service)
        forecasts: { read: true, export: true, edit: true },
      },
      fieldPermissions: basicCustomerFields,
    },
    {
      name: PROFILES.RSM,
      scope: "TERRITORY",
      permissions: {
        ...grant(TX_MODULES, MANAGER_WRITE),
        ...grant(CUSTOMER_MODULES, { ...SALES_WRITE, export: true, massUpdate: true }),
        ...grant(CATALOGUE_MODULES, { read: true }),
        ...grant(ANALYTICS_MODULES, { read: true, export: true }),
        reports: { read: true, create: true, edit: true, export: true },
        campaigns: { read: true, create: true, edit: true },
        ...EXPORT_ACCESS,
      },
      fieldPermissions: basicCustomerFields,
    },
    {
      name: PROFILES.MANAGEMENT,
      scope: "ALL",
      permissions: {
        ...grant(TX_MODULES, { read: true, export: true, massUpdate: true, approve: true }),
        ...grant(CUSTOMER_MODULES, { read: true, export: true, massUpdate: true }),
        ...grant(CATALOGUE_MODULES, { read: true }),
        ...grant(ANALYTICS_MODULES, { read: true, export: true }),
        reports: { read: true, create: true, edit: true, export: true },
        campaigns: { read: true, create: true, edit: true, massEmail: true },
        ...EXPORT_ACCESS,
        forecasts: { read: true, export: true, edit: true },
      },
      fieldPermissions: {},
    },
    {
      name: PROFILES.ADMIN,
      scope: "ALL",
      permissions: {
        ...grant(
          [...TX_MODULES, ...CUSTOMER_MODULES, ...CATALOGUE_MODULES, ...ANALYTICS_MODULES, "campaigns", "import", "export", "admin"],
          { read: true, create: true, edit: true, delete: true, export: true, massUpdate: true, massEmail: true },
        ),
      },
      fieldPermissions: {},
    },
  ];
})();

export interface SeedUser {
  key: string;
  name: string;
  role: string;
  profile: string;
  /** Territory memberships: "ROOT", "BRAND" (brand level) or "BRAND|Region". */
  territories: string[];
  manager?: string;
}

const lagos = (b: string) => `${b}|Lagos`;
const regional = (region: RegionName, brands: readonly string[]) => brands.map((b) => `${b}|${region}`);

/** 25 fictitious users covering every role, incl. multi-brand reps and one rep per regional office. */
export const USERS: SeedUser[] = [
  { key: "md", name: "Kemi Adebayo", role: ROLES.MD, profile: PROFILES.MANAGEMENT, territories: ["ROOT"] },
  { key: "hos", name: "Chidi Okonkwo", role: ROLES.HOS, profile: PROFILES.MANAGEMENT, territories: ["ROOT"], manager: "md" },
  { key: "admin", name: "Ifeoma Nwosu", role: ROLES.ADMIN, profile: PROFILES.ADMIN, territories: ["ROOT"] },

  { key: "bm.hmnl", name: "Bola Hassan", role: ROLES.BM, profile: PROFILES.BM, territories: ["HMNL"], manager: "hos" },
  { key: "bm.snmnl", name: "Emeka Obi", role: ROLES.BM, profile: PROFILES.BM, territories: ["SNMNL"], manager: "hos" },
  { key: "bm.smgl", name: "Funmi Lawal", role: ROLES.BM, profile: PROFILES.BM, territories: ["SMGL"], manager: "hos" },
  { key: "bm.thpl", name: "Musa Bello", role: ROLES.BM, profile: PROFILES.BM, territories: ["THPL"], manager: "hos" },
  { key: "bm.zanl", name: "Ngozi Eze", role: ROLES.BM, profile: PROFILES.BM, territories: ["ZANL"], manager: "hos" },

  {
    key: "rsm",
    name: "Yusuf Danjuma",
    role: ROLES.RSM,
    profile: PROFILES.RSM,
    // every <BRAND> – <Region> for Abuja / Port Harcourt / Ibadan, all 10 brands
    territories: (["Abuja", "Port Harcourt", "Ibadan"] as const).flatMap((r) =>
      regional(r, BRANDS.map((b) => b.code)),
    ),
    manager: "hos",
  },

  { key: "exec.hmnl.1", name: "Ada Okafor", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("HMNL")], manager: "bm.hmnl" },
  { key: "exec.hmnl.2", name: "Tobi Akande", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("HMNL")], manager: "bm.hmnl" },
  { key: "exec.snmnl.1", name: "Segun Ajayi", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("SNMNL")], manager: "bm.snmnl" },
  { key: "exec.snmnl.2", name: "Zainab Ali", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("SNMNL")], manager: "bm.snmnl" },
  { key: "exec.smgl.1", name: "Kunle Bakare", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("SMGL")], manager: "bm.smgl" },
  { key: "exec.smgl.2", name: "Amaka Udeh", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("SMGL")], manager: "bm.smgl" },
  { key: "exec.thpl.1", name: "Ibrahim Sule", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("THPL")], manager: "bm.thpl" },
  { key: "exec.thpl.2", name: "Bisi Ogun", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("THPL")], manager: "bm.thpl" },
  { key: "exec.zanl.1", name: "Chinedu Ike", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("ZANL")], manager: "bm.zanl" },
  { key: "exec.zanl.2", name: "Halima Musa", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("ZANL")], manager: "bm.zanl" },

  // multi-brand Lagos reps
  { key: "exec.multi.1", name: "Femi Coker", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("HMNL"), lagos("SNMNL")], manager: "bm.hmnl" },
  { key: "exec.multi.2", name: "Uche Nnaji", role: ROLES.LAGOS_EXEC, profile: PROFILES.EXEC, territories: [lagos("SMGL"), lagos("THPL"), lagos("ZANL")], manager: "bm.smgl" },

  // one rep per regional office (all active brands) + a second, two-brand Abuja rep
  { key: "exec.abuja", name: "Aisha Garba", role: ROLES.REGIONAL_EXEC, profile: PROFILES.EXEC, territories: regional("Abuja", ACTIVE_BRANDS), manager: "rsm" },
  { key: "exec.ph", name: "Tamuno Briggs", role: ROLES.REGIONAL_EXEC, profile: PROFILES.EXEC, territories: regional("Port Harcourt", ACTIVE_BRANDS), manager: "rsm" },
  { key: "exec.ibadan", name: "Lola Oyelaran", role: ROLES.REGIONAL_EXEC, profile: PROFILES.EXEC, territories: regional("Ibadan", ACTIVE_BRANDS), manager: "rsm" },
  { key: "exec.abuja.2", name: "Danladi Yakubu", role: ROLES.REGIONAL_EXEC, profile: PROFILES.EXEC, territories: regional("Abuja", ["HMNL", "SMGL"]), manager: "rsm" },
];

export const DEALS_PER_BRAND_REGION = 5;

export const VEHICLE_TYPES = ["Sedan", "SUV", "Pickup", "Hatchback", "Van"] as const;

/** Invented customer names. */
export const CUSTOMERS = [
  "Acme Logistics",
  "Blue Lagoon Hotels",
  "Crescent Foods",
  "Delta Courier Co",
  "Evergreen Schools",
  "Falcon Security",
  "Golden Grain Mills",
  "Harbour Pharma",
  "Ivory Tower Realty",
  "Jade Textiles",
  "Kestrel Builders",
  "Lighthouse Clinics",
];

export const DEAL_STAGES = [
  "ENQUIRY",
  "TEST_DRIVE",
  "QUOTATION",
  "BOOKING",
  "FINANCE_PAYMENT",
  "DELIVERY",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

export const LEADS_PER_BRAND_REGION = 3;

/** Invented lead names. Mobiles use the +234 700 000 xxxx range – not real subscriber numbers. */
export const LEAD_PEOPLE: Array<[first: string, last: string]> = [
  ["Tola", "Adewale"], ["Ike", "Nwachukwu"], ["Sade", "Bankole"], ["Garba", "Lawal"], ["Efe", "Okoro"],
  ["Kelechi", "Uzo"], ["Bimpe", "Ojo"], ["Sani", "Abubakar"], ["Nneka", "Eze"], ["Dayo", "Fashola"],
  ["Hauwa", "Idris"], ["Chuka", "Obi"],
];
export const LEAD_SOURCES_SEED = ["WALK_IN", "WEBSITE", "WHATSAPP", "REFERRAL", "PHONE", "FACEBOOK"] as const;
export const LEAD_STATUSES_SEED = ["NEW", "CONTACTED", "QUALIFIED", "NEW", "UNQUALIFIED"] as const;
export const RATINGS_SEED = ["HOT", "WARM", "COLD"] as const;

/** Fictitious catalogue: 3 models × 2 variants per active brand (generic names – not real model lines). */
export const CATALOGUE_MODELS = [
  { model: "Sedan", bodyType: "Sedan", engineCc: 1600, base: 22_000_000 },
  { model: "SUV", bodyType: "SUV", engineCc: 2000, base: 38_000_000 },
  { model: "Pickup", bodyType: "Pickup", engineCc: 2400, base: 45_000_000 },
] as const;
export const CATALOGUE_VARIANTS = [
  { variant: "Standard", factor: 1, transmission: "Manual" },
  { variant: "Premium", factor: 1.18, transmission: "Automatic" },
] as const;
export const CATALOGUE_COLOURS = ["White", "Silver", "Black", "Blue"];
