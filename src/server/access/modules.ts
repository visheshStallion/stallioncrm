/**
 * Registry of CRM modules. A module is the unit of profile permissions and of navigation.
 * `model` links a module to its Prisma model (brand-owned or shared). `prompt` is the build
 * prompt that implements it; modules without an implementation render a placeholder page.
 */
export const MODULES = [
  { key: "leads", label: "Leads", model: "Lead", prompt: "02" },
  { key: "accounts", label: "Accounts", model: "Account", prompt: "03" },
  { key: "contacts", label: "Contacts", model: "Contact", prompt: "03" },
  { key: "deals", label: "Deals", model: "Deal", prompt: "04" },
  { key: "products", label: "Products", model: "Product", prompt: "05" },
  { key: "priceBooks", label: "Price Books", model: "PriceBook", prompt: "05" },
  { key: "quotes", label: "Quotes", model: "Quote", prompt: "06" },
  { key: "salesOrders", label: "Sales Orders", model: "SalesOrder", prompt: "06" },
  { key: "invoices", label: "Invoices", model: "Invoice", prompt: "06" },
  { key: "activities", label: "Activities", model: "Activity", prompt: "07" },
  { key: "cases", label: "Cases", model: "Case", prompt: "11" },
  { key: "reports", label: "Reports", model: null, prompt: "09" },
  { key: "dashboards", label: "Dashboards", model: null, prompt: "09" },
  { key: "campaigns", label: "Campaigns", model: "Campaign", prompt: "10" },
  { key: "setup", label: "Setup", model: null, prompt: "01" },
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
