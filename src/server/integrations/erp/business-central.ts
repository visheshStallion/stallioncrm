import "server-only";
import { postJson, type ErpAdapter } from "./types";

/**
 * Microsoft Dynamics 365 Business Central (API v2.0). `ERP_BASE_URL` is the environment's API root, e.g.
 * https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0 – the company is addressed by
 * the brand's `erpCompanyCode` (the BC company id), so each legal entity posts into its own company.
 * `ERP_TOKEN` is an OAuth access token obtained by the deployment (client credentials); token refresh is the
 * deployment's concern.
 */
export const businessCentral: ErpAdapter = {
  key: "business-central",
  async postDocument(doc, { baseUrl, token }) {
    if (!baseUrl) throw new Error("ERP_BASE_URL is not configured");
    const resource = doc.type === "invoice" ? "salesInvoices" : "salesOrders";
    const dateField = doc.type === "invoice" ? "invoiceDate" : "orderDate";
    const body = {
      externalDocumentNumber: doc.number,
      [dateField]: doc.issueDate,
      ...(doc.dueDate && doc.type === "invoice" ? { dueDate: doc.dueDate } : {}),
      customerName: doc.customerName,
      // customer matching in the ERP: tax id first, then phone, then name (prompt 23 – documents without an account)
      ...(doc.customer.taxId ? { customerTaxRegistrationNumber: doc.customer.taxId } : {}),
      ...(doc.customer.phone ? { phoneNumber: doc.customer.phone } : {}),
      currencyCode: doc.currency,
      [doc.type === "invoice" ? "salesInvoiceLines" : "salesOrderLines"]: doc.lines.map((l) => ({
        sequence: l.position,
        lineType: "Item",
        description: l.vin ? `${l.description} (VIN ${l.vin})` : l.description,
        quantity: l.qty,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPct,
        taxPercent: l.taxRate,
      })),
    };
    const raw = (await postJson(`${baseUrl.replace(/\/$/, "")}/companies(${encodeURIComponent(doc.companyCode)})/${resource}`, token, body)) as { id?: string; number?: string };
    if (!raw.id) throw new Error("Business Central did not return a document id");
    return { externalId: raw.id, raw: { number: raw.number } };
  },
};
