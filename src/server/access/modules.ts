/**
 * Registry of CRM modules. A module is the unit of profile permissions and of navigation.
 * `model` links a module to its Prisma model (brand-owned or shared). `prompt` is the build
 * prompt that implements it; modules without an implementation render a placeholder page.
 * `nav: false` = capability only (permission row in profiles, no page in the left nav).
 */
export const MODULES = [
  { key: "leads", label: "Leads", model: "Lead", prompt: "02", nav: true },
  { key: "accounts", label: "Accounts", model: "Account", prompt: "03", nav: true },
  { key: "contacts", label: "Contacts", model: "Contact", prompt: "03", nav: true },
  { key: "deals", label: "Deals", model: "Deal", prompt: "04", nav: true },
  { key: "products", label: "Products", model: "Product", prompt: "05", nav: true },
  { key: "priceBooks", label: "Price Books", model: "PriceBook", prompt: "05", nav: true },
  { key: "quotes", label: "Quotes", model: "Quote", prompt: "06", nav: true },
  { key: "salesOrders", label: "Sales Orders", model: "SalesOrder", prompt: "06", nav: true },
  { key: "invoices", label: "Invoices", model: "Invoice", prompt: "06", nav: true },
  { key: "activities", label: "Activities", model: "Activity", prompt: "07", nav: true },
  { key: "cases", label: "Cases", model: "Case", prompt: "11", nav: true },
  { key: "campaigns", label: "Campaigns", model: "Campaign", prompt: "10", nav: true },
  { key: "inventory", label: "Inventory", model: "VehicleUnit", prompt: "16", nav: true },
  // capability: cost, bills, landed cost, valuation and journals (sensitive tier)
  { key: "inventoryFinance", label: "Inventory finance", model: null, prompt: "16", nav: false },
  { key: "reports", label: "Reports", model: null, prompt: "09", nav: true },
  { key: "dashboards", label: "Dashboards", model: null, prompt: "09", nav: true },
  { key: "forecasts", label: "Forecasts", model: null, prompt: "09", nav: true },
  { key: "import", label: "Import", model: null, prompt: "12", nav: false },
  { key: "export", label: "Export", model: null, prompt: "12", nav: false },
  { key: "admin", label: "Admin", model: null, prompt: "01", nav: true },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type ModuleDef = (typeof MODULES)[number];

export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

export function getModule(key: string): ModuleDef | undefined {
  return MODULES.find((m) => m.key === key);
}

export function isModuleKey(key: string): key is ModuleKey {
  return MODULES.some((m) => m.key === key);
}
