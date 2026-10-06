/**
 * Module rail order (Zoho-familiar) and Quick Create entries. Only modules the profile can READ are shown;
 * entries whose module is not built yet still appear (placeholder page) so users learn the layout.
 */
export interface RailItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** Counter shown on the item (e.g. overdue activities). */
  badge?: number;
}

export const RAIL_ORDER: RailItem[] = [
  { key: "home", label: "Home", href: "/", icon: "home" },
  { key: "leads", label: "Leads", href: "/leads", icon: "user-plus" },
  { key: "contacts", label: "Contacts", href: "/contacts", icon: "contact" },
  { key: "accounts", label: "Accounts", href: "/accounts", icon: "building" },
  { key: "deals", label: "Deals", href: "/deals", icon: "handshake" },
  { key: "activities", label: "Activities", href: "/activities", icon: "calendar-check" },
  { key: "quotes", label: "Quotes", href: "/quotes", icon: "file-text" },
  { key: "salesOrders", label: "Sales Orders", href: "/salesOrders", icon: "shopping-cart" },
  { key: "invoices", label: "Invoices", href: "/invoices", icon: "receipt" },
  { key: "products", label: "Products", href: "/products", icon: "car" },
  { key: "priceBooks", label: "Price Books", href: "/priceBooks", icon: "book-open" },
  { key: "inventory", label: "Inventory", href: "/inventory", icon: "warehouse" },
  { key: "cases", label: "Cases", href: "/cases", icon: "life-buoy" },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", icon: "megaphone" },
  { key: "reports", label: "Reports", href: "/reports", icon: "bar-chart" },
  { key: "dashboards", label: "Analytics", href: "/dashboards", icon: "layout-dashboard" },
  { key: "forecasts", label: "Forecasts", href: "/forecasts", icon: "trending-up" },
  { key: "approvals", label: "Approvals", href: "/approvals", icon: "check-circle" },
];

/** Shown in the rail before "More" unless the user pinned differently. */
export const DEFAULT_PINNED = ["home", "leads", "contacts", "accounts", "deals", "activities", "approvals", "quotes", "salesOrders", "invoices", "products", "reports", "dashboards"];

export interface QuickCreateItem {
  key: string;
  label: string;
  module: string;
  /** "drawer" = quick create drawer (mandatory fields), otherwise a link to the full form. */
  mode: "drawer" | "link";
  href?: string;
}

export const QUICK_CREATE: QuickCreateItem[] = [
  { key: "lead", label: "Lead", module: "leads", mode: "drawer" },
  { key: "contact", label: "Contact", module: "contacts", mode: "link", href: "/contacts/new" },
  { key: "deal", label: "Deal", module: "deals", mode: "drawer" },
  { key: "task", label: "Task", module: "activities", mode: "link", href: "/activities/new?type=task" },
  { key: "meeting", label: "Meeting", module: "activities", mode: "link", href: "/activities/new?type=meeting" },
  { key: "call", label: "Call", module: "activities", mode: "link", href: "/activities/new?type=call" },
  { key: "quote", label: "Quote", module: "quotes", mode: "link", href: "/quotes/new" },
  { key: "salesOrder", label: "Sales Order", module: "salesOrders", mode: "link", href: "/salesOrders/new" },
  { key: "invoice", label: "Invoice", module: "invoices", mode: "link", href: "/invoices/new" },
  { key: "template", label: "From a template…", module: "leads", mode: "link", href: "/templates/pick" },
];
