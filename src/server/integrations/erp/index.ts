/**
 * ERP / accounting integration per legal entity (prompt 13).
 *
 * A confirmed sales order or issued invoice is posted to the ERP company of ITS brand (`Brand.erpCompanyCode`),
 * by the adapter configured for that brand: `ERP_ADAPTER[_<BRAND>]` = business-central | zoho-books | csv
 * (unset = off). The ERP's id is kept in `ExternalRef`; a payment recorded in the ERP comes back through
 * `POST /api/public/webhooks/erp` and is booked on the invoice (`reconcilePayment`).
 */
import "server-only";
import type { Job } from "@prisma/client";
import * as store from "@/server/db/api-store";
import { BadRequestError } from "@/server/errors";
import { brandEnv } from "../config";
import { businessCentral } from "./business-central";
import { csvOutbox } from "./csv";
import type { ErpAdapter, ErpDocument } from "./types";
import { zohoBooks } from "./zoho-books";

export const ERP_ADAPTERS: Record<string, ErpAdapter> = { "business-central": businessCentral, "zoho-books": zohoBooks, csv: csvOutbox };

export function erpAdapterFor(brandCode: string): ErpAdapter | null {
  const key = brandEnv("ERP_ADAPTER", brandCode);
  return key && key !== "off" ? (ERP_ADAPTERS[key] ?? null) : null;
}

export async function erpEnabledFor(brandId: string): Promise<boolean> {
  const brand = await store.brandForIntegration(brandId);
  return !!brand && !!erpAdapterFor(brand.code);
}

/** Job handler "erp.post": posts one document to the company of its own brand. Throws → retried with back-off. */
export async function postDocumentJob(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { entity, entityId, brandId } = job.payload as { entity: "SalesOrder" | "Invoice"; entityId: string; brandId: string };
  const brand = await store.brandForIntegration(brandId);
  if (!brand) return { skipped: "brand removed" };
  const adapter = erpAdapterFor(brand.code);
  if (!adapter) return { skipped: "ERP integration is off for this brand" };
  if (!brand.erpCompanyCode) throw new Error(`Brand ${brand.code} has no ERP company code (Setup → Brands)`);
  const system = `erp:${adapter.key}`;
  const existing = await store.findExternalRef(system, entity, entityId);
  if (existing) return { skipped: "already posted", externalId: existing.externalId };

  // The document is read with a context bound to the brand of the event – it cannot load another brand's document.
  const { automationContext } = await import("@/server/modules/workflow/engine");
  const { getDocument } = await import("@/server/modules/documents/queries");
  const type = entity === "Invoice" ? "invoice" : "salesOrder";
  const d = await getDocument(automationContext(brandId), type, entityId);
  const doc: ErpDocument = {
    type,
    id: d.id,
    number: d.number,
    brandCode: brand.code,
    companyCode: brand.erpCompanyCode,
    issueDate: d.issueDate.slice(0, 10),
    dueDate: d.date ? d.date.slice(0, 10) : null,
    currency: d.currency,
    customerName: d.customerName,
    accountId: d.accountId,
    dealId: d.dealId,
    customer: { name: d.billTo?.name ?? d.customerName, taxId: d.billTo?.taxId ?? null, phone: d.billTo?.phone ?? null, email: d.billTo?.email ?? null, address: [d.billTo?.address, d.billTo?.city, d.billTo?.state].filter(Boolean).join(", ") || null },
    subtotal: d.subtotal,
    discountTotal: d.discountTotal,
    taxTotal: d.taxTotal,
    total: d.total,
    lines: d.lines.map(({ position, description, qty, unitPrice, discountPct, taxRate, lineTotal, vin }) => ({ position, description, qty, unitPrice, discountPct, taxRate, lineTotal, vin })),
  };
  const posted = await adapter.postDocument(doc, { baseUrl: brandEnv("ERP_BASE_URL", brand.code), token: brandEnv("ERP_TOKEN", brand.code) });
  await store.upsertExternalRef({ system, entity, entityId, brandId, companyCode: brand.erpCompanyCode, externalId: posted.externalId, status: "POSTED", data: JSON.parse(JSON.stringify(posted.raw ?? null)) ?? undefined });
  return { system, companyCode: brand.erpCompanyCode, externalId: posted.externalId };
}

/**
 * Payment status coming back from the ERP: books the receipt on the CRM invoice the external id belongs to.
 * The company code must match the one the invoice was posted to, so one company's feed cannot settle another
 * brand's invoice. Idempotent per payment reference.
 */
export async function reconcilePayment(input: { system?: string; externalId?: string; companyCode?: string; amount?: number; reference?: string; receivedAt?: string }) {
  if (!input.externalId || !input.companyCode || !input.reference || !(Number(input.amount) > 0)) throw new BadRequestError("externalId, companyCode, reference and amount are required");
  const systems = input.system ? [`erp:${input.system}`] : Object.keys(ERP_ADAPTERS).map((k) => `erp:${k}`);
  let ref = null;
  for (const s of systems) ref ??= await store.findExternalRefByExternalId(s, input.externalId);
  if (!ref || ref.entity !== "Invoice" || ref.companyCode !== input.companyCode) throw new BadRequestError("Unknown invoice for this company");
  if (await store.paymentByReference(ref.entityId, input.reference)) return { duplicate: true };
  const { automationContext } = await import("@/server/modules/workflow/engine");
  const { addPayment } = await import("@/server/modules/documents/service");
  const res = await addPayment(automationContext(ref.brandId), ref.entityId, { amount: input.amount, method: "TRANSFER", reference: input.reference, receivedAt: input.receivedAt });
  return { duplicate: false, invoiceId: ref.entityId, status: res.status };
}

/** Job handler "erp.journal": an inventory journal goes to the ERP company of ITS brand (adapters that support it). */
export async function postJournalJob(job: Pick<Job, "payload">): Promise<Record<string, unknown>> {
  const { journalId, brandId } = job.payload as { journalId: string; brandId: string };
  const brand = await store.brandForIntegration(brandId);
  const adapter = brand ? erpAdapterFor(brand.code) : null;
  if (!brand || !adapter?.postJournal) return { skipped: "the brand's ERP adapter does not take journals" };
  if (!brand.erpCompanyCode) throw new Error(`Brand ${brand.code} has no ERP company code (Setup → Brands)`);
  const posting = await import("@/server/db/inventory-posting");
  const j = await posting.journalForExport(journalId);
  if (!j || j.brandId !== brandId) return { skipped: "journal not found" };
  if (j.exportedAt) return { skipped: "already exported" };
  const num = (d: { toString(): string }) => Number(d.toString());
  const out = await adapter.postJournal({ id: j.id, number: j.number, companyCode: brand.erpCompanyCode, date: j.date.toISOString().slice(0, 10), memo: j.memo, lines: j.lines.map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit), memo: l.memo })) }, { baseUrl: brandEnv("ERP_BASE_URL", brand.code), token: brandEnv("ERP_TOKEN", brand.code) });
  await posting.markJournalsExported([j.id]);
  return { companyCode: brand.erpCompanyCode, externalId: out.externalId };
}
