import "server-only";
import { toCsv } from "@/lib/csv";
import { storage } from "@/server/storage";
import type { ErpAdapter } from "./types";

/**
 * Generic CSV hand-over for ERPs without an API: one file per document under
 * `erp-outbox/<company code>/` in the configured storage (local disk or S3). An SFTP job of the deployment (or
 * the ERP's import folder mounted as storage) picks the files up – one folder per legal entity, so documents of
 * one brand can never land in another brand's company.
 */
export const csvOutbox: ErpAdapter = {
  key: "csv",
  async postDocument(doc) {
    const header = ["documentType", "number", "company", "date", "dueDate", "customer", "currency", "line", "description", "vin", "qty", "unitPrice", "discountPct", "taxRate", "lineTotal", "documentTotal"];
    const rows = doc.lines.map((l) => [doc.type, doc.number, doc.companyCode, doc.issueDate, doc.dueDate ?? "", doc.customerName ?? "", doc.currency, l.position, l.description, l.vin ?? "", l.qty, l.unitPrice, l.discountPct, l.taxRate, l.lineTotal, doc.total]);
    const key = `erp-outbox/${doc.companyCode.replace(/[^A-Za-z0-9_-]/g, "_")}/${doc.number}.csv`;
    await storage().put(key, new TextEncoder().encode(toCsv(header, rows)), "text/csv; charset=utf-8");
    return { externalId: key };
  },
};
