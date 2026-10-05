/**
 * Printable modules (prompt 20 §A1). Each module prints what its own detail query returns for the user: the loader
 * is the SAME function the detail page uses, so access checks (404 for hidden records), the customer "basic fields"
 * rule, cost visibility and field-level security are exactly those of the screen – print adds nothing.
 */
import "server-only";
import { fieldMaskView } from "@/server/access/field-mask";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";

type Row = Record<string, unknown>;

export interface PrintModule {
  key: string;
  label: string;
  plural: string;
  /** name of the record in merge fields: {{deal.name}} */
  mergeName: string;
  /** module whose profile permission decides (read for one record, export for lists of customer data) */
  permission: ModuleKey;
  /** lists and bulk prints of this module are customer lists: they need the export permission */
  exportSensitive: boolean;
  /** true = brand-owned or brand-tagged: the record's brand letterhead is used, always */
  path: (id: string) => string;
  load: (ctx: AccessContext, id: string) => Promise<Row>;
}

const mask = <T extends object>(ctx: AccessContext, module: ModuleKey, row: T): Row => fieldMaskView(ctx, module, row) as Row;

export const PRINT_MODULES: PrintModule[] = [
  { key: "leads", label: "Lead", plural: "Leads", mergeName: "lead", permission: "leads", exportSensitive: true, path: (id) => `/leads/${id}`, load: async (ctx, id) => mask(ctx, "leads", await (await import("@/server/modules/leads/queries")).getLead(ctx, id)) },
  { key: "contacts", label: "Contact", plural: "Contacts", mergeName: "contact", permission: "contacts", exportSensitive: true, path: (id) => `/contacts/${id}`, load: async (ctx, id) => mask(ctx, "contacts", await (await import("@/server/modules/customers/queries")).getContact(ctx, id)) },
  { key: "accounts", label: "Account", plural: "Accounts", mergeName: "account", permission: "accounts", exportSensitive: true, path: (id) => `/accounts/${id}`, load: async (ctx, id) => mask(ctx, "accounts", await (await import("@/server/modules/customers/queries")).getAccount(ctx, id)) },
  { key: "deals", label: "Deal", plural: "Deals", mergeName: "deal", permission: "deals", exportSensitive: false, path: (id) => `/deals/${id}`, load: async (ctx, id) => mask(ctx, "deals", await (await import("@/server/modules/deals/queries")).getDeal(ctx, id)) },
  { key: "quotes", label: "Quotation", plural: "Quotes", mergeName: "quote", permission: "quotes", exportSensitive: false, path: (id) => `/quotes/${id}`, load: async (ctx, id) => mask(ctx, "quotes", await (await import("@/server/modules/documents/queries")).getDocument(ctx, "quote", id)) },
  { key: "salesOrders", label: "Sales Order", plural: "Sales Orders", mergeName: "salesOrder", permission: "salesOrders", exportSensitive: false, path: (id) => `/salesOrders/${id}`, load: async (ctx, id) => mask(ctx, "salesOrders", await (await import("@/server/modules/documents/queries")).getDocument(ctx, "salesOrder", id)) },
  { key: "invoices", label: "Invoice", plural: "Invoices", mergeName: "invoice", permission: "invoices", exportSensitive: false, path: (id) => `/invoices/${id}`, load: async (ctx, id) => mask(ctx, "invoices", await (await import("@/server/modules/documents/queries")).getDocument(ctx, "invoice", id)) },
  { key: "activities", label: "Activity", plural: "Activities", mergeName: "activity", permission: "activities", exportSensitive: false, path: (id) => `/activities/${id}`, load: async (ctx, id) => mask(ctx, "activities", await (await import("@/server/modules/activities/queries")).getActivity(ctx, id)) },
  { key: "cases", label: "Case", plural: "Cases", mergeName: "case", permission: "cases", exportSensitive: false, path: (id) => `/cases/${id}`, load: async (ctx, id) => mask(ctx, "cases", await (await import("@/server/modules/cases/queries")).getCase(ctx, id)) },
  { key: "products", label: "Product", plural: "Products", mergeName: "product", permission: "products", exportSensitive: false, path: (id) => `/products/${id}`, load: async (ctx, id) => mask(ctx, "products", await (await import("@/server/modules/catalogue/queries")).getProduct(ctx, id)) },
  { key: "priceBooks", label: "Price Book", plural: "Price Books", mergeName: "priceBook", permission: "priceBooks", exportSensitive: false, path: (id) => `/priceBooks/${id}`, load: async (ctx, id) => mask(ctx, "priceBooks", await (await import("@/server/modules/catalogue/queries")).getPriceBook(ctx, id)) },
  { key: "campaigns", label: "Campaign", plural: "Campaigns", mergeName: "campaign", permission: "campaigns", exportSensitive: false, path: (id) => `/campaigns/${id}`, load: async (ctx, id) => mask(ctx, "campaigns", await (await import("@/server/modules/messaging/campaigns")).getCampaign(ctx, id)) },
  { key: "inventoryDocuments", label: "Inventory Document", plural: "Inventory Documents", mergeName: "document", permission: "inventory", exportSensitive: false, path: (id) => `/inventory/documents/${id}`, load: async (ctx, id) => (await (await import("@/server/modules/inventory/queries")).getInvDocument(ctx, id)) as unknown as Row },
  { key: "vehicleUnits", label: "Vehicle", plural: "Vehicle Units", mergeName: "vehicle", permission: "inventory", exportSensitive: false, path: (id) => `/inventory/units/${id}`, load: async (ctx, id) => (await (await import("@/server/modules/inventory/queries")).getUnit(ctx, id)) as unknown as Row },
];

export function printModule(key: string): PrintModule | undefined {
  return PRINT_MODULES.find((m) => m.key === key);
}

/** Module keys only (for client components and the template designer's pickers). */
export const PRINT_MODULE_OPTIONS = PRINT_MODULES.map((m) => ({ key: m.key, label: m.label, plural: m.plural }));
