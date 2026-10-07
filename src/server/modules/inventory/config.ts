/**
 * Inventory documents (prompt 16 §2): one header + lines table (`InventoryDocument`), one configuration per
 * type. The configuration says who may work with a type, which statuses exist and which header fields and line
 * shape the editor shows. Status changes themselves are in `service.ts` / the posting engine.
 */
import { z } from "zod";

export const DOC_TYPES = ["PO", "SHIPMENT", "GRN", "BILL", "LANDED_COST", "TRANSFER", "INTER_BRAND", "ADJUSTMENT", "PDI", "DELIVERY_NOTE", "STOCK_COUNT", "VENDOR_CREDIT"] as const;
export type InvDocType = (typeof DOC_TYPES)[number];

export type LineKind = "ITEM" | "ITEM_VIN" | "UNIT" | "CHARGE" | "NONE";

export interface InvDocConfig {
  type: InvDocType;
  label: string;
  plural: string;
  /** permission module needed to create / post: operations ("inventory") or finance ("inventoryFinance") */
  area: "inventory" | "inventoryFinance";
  statuses: string[];
  initialStatus: string;
  /** header fields shown in the editor */
  fields: Array<"vendorId" | "warehouseId" | "toWarehouseId" | "toBrandId" | "currency" | "expectedDate" | "reference" | "parent">;
  /** ITEM: item + qty + cost · ITEM_VIN: item + VIN (+ colour) + cost · UNIT: a vehicle from stock · CHARGE: description + amount */
  lines: LineKind;
  /** shows costs: hidden from users without inventory finance read access */
  costed: boolean;
  /** created by the system only (no "New" button) */
  system?: boolean;
  parentTypes?: InvDocType[];
  referenceLabel?: string;
}

export const INV_DOCS: Record<InvDocType, InvDocConfig> = {
  PO: { type: "PO", label: "Purchase order", plural: "Purchase orders", area: "inventory", statuses: ["DRAFT", "PENDING_APPROVAL", "ISSUED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"], initialStatus: "DRAFT", fields: ["vendorId", "warehouseId", "currency", "expectedDate", "reference"], lines: "ITEM", costed: true, referenceLabel: "Vendor reference" },
  SHIPMENT: { type: "SHIPMENT", label: "Shipment", plural: "Shipments", area: "inventory", statuses: ["ORDERED", "SHIPPED", "AT_PORT", "CLEARING", "CLEARED", "DELIVERED"], initialStatus: "ORDERED", fields: ["vendorId", "expectedDate", "reference", "parent"], lines: "ITEM_VIN", costed: false, parentTypes: ["PO"], referenceLabel: "Bill of lading no." },
  GRN: { type: "GRN", label: "Goods receipt", plural: "Goods receipts", area: "inventory", statuses: ["DRAFT", "RECEIVED"], initialStatus: "DRAFT", fields: ["vendorId", "warehouseId", "currency", "reference", "parent"], lines: "ITEM_VIN", costed: true, parentTypes: ["PO", "SHIPMENT"], referenceLabel: "Delivery note / waybill no." },
  BILL: { type: "BILL", label: "Vendor bill", plural: "Vendor bills", area: "inventoryFinance", statuses: ["DRAFT", "OPEN", "PARTIALLY_PAID", "PAID", "VOID"], initialStatus: "DRAFT", fields: ["vendorId", "currency", "expectedDate", "reference", "parent"], lines: "CHARGE", costed: true, parentTypes: ["GRN", "PO"], referenceLabel: "Vendor invoice no." },
  LANDED_COST: { type: "LANDED_COST", label: "Landed cost voucher", plural: "Landed cost vouchers", area: "inventoryFinance", statuses: ["DRAFT", "ALLOCATED"], initialStatus: "DRAFT", fields: ["vendorId", "currency", "reference", "parent"], lines: "CHARGE", costed: true, parentTypes: ["SHIPMENT", "GRN"], referenceLabel: "Customs / agent reference" },
  TRANSFER: { type: "TRANSFER", label: "Transfer order", plural: "Transfer orders", area: "inventory", statuses: ["DRAFT", "IN_TRANSIT", "RECEIVED"], initialStatus: "DRAFT", fields: ["warehouseId", "toWarehouseId", "reference"], lines: "UNIT", costed: false },
  INTER_BRAND: { type: "INTER_BRAND", label: "Inter-brand transfer", plural: "Inter-brand transfers", area: "inventory", statuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SHIPPED", "RECEIVED"], initialStatus: "DRAFT", fields: ["toBrandId", "reference"], lines: "UNIT", costed: true },
  ADJUSTMENT: { type: "ADJUSTMENT", label: "Inventory adjustment", plural: "Inventory adjustments", area: "inventory", statuses: ["DRAFT", "PENDING_APPROVAL", "ADJUSTED"], initialStatus: "DRAFT", fields: ["warehouseId", "reference"], lines: "UNIT", costed: true, referenceLabel: "Reason" },
  PDI: { type: "PDI", label: "PDI checklist", plural: "PDI checklists", area: "inventory", statuses: ["PENDING", "PASSED", "FAILED"], initialStatus: "PENDING", fields: [], lines: "NONE", costed: false, system: true },
  DELIVERY_NOTE: { type: "DELIVERY_NOTE", label: "Delivery note / gate pass", plural: "Delivery notes", area: "inventory", statuses: ["PREPARED", "DELIVERED"], initialStatus: "DELIVERED", fields: [], lines: "NONE", costed: false, system: true },
  STOCK_COUNT: { type: "STOCK_COUNT", label: "Stock count", plural: "Stock counts", area: "inventory", statuses: ["PLANNED", "COUNTING", "RECONCILED"], initialStatus: "PLANNED", fields: ["warehouseId", "reference"], lines: "NONE", costed: false, referenceLabel: "Count name" },
  VENDOR_CREDIT: { type: "VENDOR_CREDIT", label: "Vendor credit / purchase return", plural: "Vendor credits", area: "inventoryFinance", statuses: ["DRAFT", "OPEN", "APPLIED"], initialStatus: "DRAFT", fields: ["vendorId", "warehouseId", "reference"], lines: "UNIT", costed: true },
};

export const isDocType = (t: string): t is InvDocType => (DOC_TYPES as readonly string[]).includes(t);
import { PO_STATUS_LABELS } from "./po-config";

/** Status as shown: purchase orders use the PO page names (Created, Approved, Sent to Vendor …). */
export const statusLabel = (s: string, type?: string) => (type === "PO" && PO_STATUS_LABELS[s]) || s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export const WAREHOUSE_TYPES = ["SHOWROOM", "MAIN_YARD", "PORT", "PDI_CENTRE", "PARTS_STORE", "IN_TRANSIT"] as const;
export const VENDOR_TYPES = ["OEM", "DISTRIBUTOR", "CLEARING_AGENT", "SHIPPING_LINE", "TRANSPORTER", "PARTS_SUPPLIER"] as const;
export const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;
export const CHARGE_TYPES = ["Customs duty", "CISS / levy", "Port charges", "Terminal charges", "Clearing agent", "Shipping", "Insurance", "Haulage", "Other"] as const;
export const ADJUSTMENT_ACTIONS = ["WRITE_OFF", "REVALUE", "HOLD", "RELEASE"] as const;
export const ADJUSTMENT_REASONS = ["Damage", "Theft", "Count variance", "Write-off", "Demo depreciation", "Other"] as const;

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const optionalId = z.preprocess(empty, z.string().max(40).optional());
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional());

export const lineSchema = z.object({
  productId: optionalId,
  vehicleUnitId: optionalId,
  vin: text(40),
  description: text(300),
  qty: z.preprocess((v) => (v === "" || v === null || v === undefined ? 1 : v), z.coerce.number().min(-1e9).max(1e9)),
  unitCost: z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(-1e13).max(1e13)),
  batchNo: text(40),
  data: z.record(z.unknown()).default({}),
});
export type LineInput = z.input<typeof lineSchema>;

export const docSchema = z.object({
  brandId: z.string().min(1, "Choose the brand"),
  vendorId: optionalId,
  warehouseId: optionalId,
  toWarehouseId: optionalId,
  toBrandId: optionalId,
  parentId: optionalId,
  currency: z.preprocess(empty, z.enum(CURRENCIES).default("NGN")),
  exchangeRate: z.preprocess((v) => (v === "" || v === null || v === undefined ? 1 : v), z.coerce.number().positive("The exchange rate must be positive").max(1e7)),
  docDate: z.preprocess(empty, z.coerce.date().optional()),
  expectedDate: z.preprocess(empty, z.coerce.date().optional()),
  reference: text(120),
  notes: text(2000),
  data: z.record(z.unknown()).default({}),
  lines: z.array(lineSchema).max(500).default([]),
});
export type DocInput = z.input<typeof docSchema>;

export const warehouseSchema = z.object({
  brandId: z.string().min(1),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "2–20 letters, digits or dashes"),
  name: z.string().trim().min(2).max(100),
  type: z.enum(WAREHOUSE_TYPES),
  regionId: optionalId,
  address: text(300),
  active: z.boolean().default(true),
});

export const vendorSchema = z.object({
  brandId: z.string().min(1),
  type: z.enum(VENDOR_TYPES),
  name: z.string().trim().min(2).max(120),
  contactName: text(100),
  email: z.preprocess(empty, z.string().trim().email().max(200).optional()),
  phone: text(40),
  currency: z.preprocess(empty, z.enum(CURRENCIES).default("NGN")),
  paymentTerms: text(120),
  address: text(300),
  taxId: text(60),
  bankDetails: text(500),
  active: z.boolean().default(true),
  // ── Create Vendor page ──
  ownerId: z.preprocess(empty, z.string().max(40).optional()),
  website: z.preprocess(empty, z.string().trim().max(200).regex(/^(https?:\/\/)?[^\s]+\.[^\s]+$/, "Enter a web address").optional()),
  glAccount: text(80),
  category: text(80),
  emailOptOut: z.boolean().default(false),
  city: text(80),
  state: text(80),
  zipCode: text(20),
  country: text(80),
  description: text(4000),
});

/** GL Account picklist of a vendor (where its bills are booked). */
export const GL_ACCOUNTS = ["Purchases – Vehicles", "Purchases – Spare parts", "Purchases – Accessories", "Freight and clearing", "Services", "Rental", "Sales-Software", "Sales-Hardware", "Other"] as const;

export const settingsSchema = z.object({
  reservationDays: z.coerce.number().int().min(1).max(90),
  adjustmentApprovalLimit: z.coerce.number().min(0).max(1e12),
  poApprovalLimit: z.coerce.number().min(0).max(1e13),
  lockDate: z.preprocess(empty, z.coerce.date().optional()),
  partsValuation: z.enum(["FIFO", "WEIGHTED_AVERAGE"]),
  pdiTemplate: z.preprocess((v) => (typeof v === "string" ? v.split(/\r?\n/) : v), z.array(z.string().trim().min(1).max(120)).max(40)),
  accounts: z.record(z.string().max(120)).default({}),
});

export const DEFAULT_PDI = ["Exterior paint and body", "Interior trim", "Fluids and levels", "Tyres and spare", "Lights and electrics", "Road test", "Documents and keys"];
