/**
 * OEM portals (prompt 13) – adapter interface only. Each manufacturer has its own portal for retail-sales
 * reporting and warranty registration; none of them is integrated yet. A brand's adapter is selected with
 * `OEM_ADAPTER_<BRAND>`; the only adapter shipped is the no-op below, so the feature is off everywhere.
 * To integrate a portal: implement `OemAdapter` in this folder, register it in `OEM_ADAPTERS`, and call
 * `oemAdapterFor(brand.code)?.submitRetailSale(...)` from a job on `invoice.paid` / delivery.
 */
import "server-only";
import { brandEnv } from "../config";

export interface RetailSale {
  brandCode: string;
  vin: string;
  modelName: string;
  deliveryDate: string;
  customerName: string;
  invoiceNumber: string;
}

export interface WarrantyRegistration {
  brandCode: string;
  vin: string;
  startDate: string;
  customerName: string;
  customerPhone: string | null;
}

export interface OemAdapter {
  key: string;
  submitRetailSale(sale: RetailSale): Promise<{ externalId: string }>;
  registerWarranty(reg: WarrantyRegistration): Promise<{ externalId: string }>;
}

/** Accepts everything and does nothing – for demos and tests. */
export const noopOem: OemAdapter = {
  key: "noop",
  submitRetailSale: async (sale) => ({ externalId: `noop-sale-${sale.vin}` }),
  registerWarranty: async (reg) => ({ externalId: `noop-warranty-${reg.vin}` }),
};

export const OEM_ADAPTERS: Record<string, OemAdapter> = { noop: noopOem };

export function oemAdapterFor(brandCode: string): OemAdapter | null {
  const key = process.env[`OEM_ADAPTER_${brandCode.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]?.trim() ?? brandEnv("OEM_ADAPTER", brandCode);
  return key ? (OEM_ADAPTERS[key] ?? null) : null;
}
