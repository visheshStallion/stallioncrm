import "server-only";
import { postJson, type ErpAdapter } from "./types";

/**
 * Zoho Books (API v3). `ERP_BASE_URL` e.g. https://www.zohoapis.com/books/v3; the brand's `erpCompanyCode` is
 * the Books organization id of its legal entity. `ERP_TOKEN` is the OAuth access token.
 */
export const zohoBooks: ErpAdapter = {
  key: "zoho-books",
  async postDocument(doc, { baseUrl, token }) {
    if (!baseUrl) throw new Error("ERP_BASE_URL is not configured");
    const resource = doc.type === "invoice" ? "invoices" : "salesorders";
    const body = {
      [doc.type === "invoice" ? "invoice_number" : "salesorder_number"]: doc.number,
      reference_number: doc.number,
      date: doc.issueDate,
      ...(doc.dueDate && doc.type === "invoice" ? { due_date: doc.dueDate } : {}),
      customer_name: doc.customerName,
      currency_code: doc.currency,
      line_items: doc.lines.map((l) => ({ item_order: l.position, description: l.vin ? `${l.description} (VIN ${l.vin})` : l.description, quantity: l.qty, rate: l.unitPrice, discount: `${l.discountPct}%`, tax_percentage: l.taxRate })),
    };
    const raw = (await postJson(`${baseUrl.replace(/\/$/, "")}/${resource}?organization_id=${encodeURIComponent(doc.companyCode)}`, undefined, body, token ? { Authorization: `Zoho-oauthtoken ${token}` } : {})) as Record<string, { invoice_id?: string; salesorder_id?: string } | undefined>;
    const externalId = raw.invoice?.invoice_id ?? raw.salesorder?.salesorder_id;
    if (!externalId) throw new Error("Zoho Books did not return a document id");
    return { externalId };
  },
};
