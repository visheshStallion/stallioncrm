/**
 * A fictitious printable record for the pure renderers (unit and visual tests of document templates): a document
 * with line items, totals, a customer and a vehicle. No database, no real names.
 */
import type { Letterhead } from "../../src/server/modules/print/blocks";
import type { PrintRecord, PrintTable } from "../../src/server/modules/print/describe";

export const LETTERHEAD: Letterhead = { brandId: "demo", code: "DEMO", name: "Demo Motors", legalEntity: "Demo Motors Nigeria Ltd", rcNumber: "000000", address: "1 Sample Road, Lagos", phone: "+234 800 000 0000", email: "sales@demo.example", website: "demo.example", vatNumber: "00000000-0001", bankDetails: "Demo Bank Plc\nAccount 0000000000", color: "#1565d0", footerText: null, logo: null };
export const OTHER_LETTERHEAD: Letterhead = { ...LETTERHEAD, brandId: "other", code: "OTHR", name: "Other Autos", legalEntity: "Other Autos Ltd", color: "#c9282d", bankDetails: null };

export function linesTable(count: number): PrintTable {
  return {
    key: "lines",
    title: "Lines",
    columns: [
      { key: "description", label: "Description", align: "left" },
      { key: "vin", label: "VIN", align: "left" },
      { key: "quantity", label: "Quantity", align: "right" },
      { key: "unitPrice", label: "Unit price", align: "right" },
      { key: "lineTotal", label: "Line total", align: "right" },
    ],
    rows: Array.from({ length: count }, (_, i) => [i === 0 ? "SUV Premium 2.0" : `Accessory pack ${i}`, i === 0 ? "DEMO0000000000001" : "", "1", i === 0 ? "₦ 30,000,000.00" : "₦ 25,000.00", i === 0 ? "₦ 30,000,000.00" : "₦ 25,000.00"]),
  };
}

export function sampleRecord(module: string, o: { lines?: number; paymentType?: string; brandId?: string; amountPaid?: number } = {}): PrintRecord {
  const lines = linesTable(o.lines ?? 3);
  const paid = o.amountPaid ?? 10_000_000;
  const root = {
    name: module === "deals" ? "SUV – Acme Logistics" : "INV-2026-00045",
    number: module === "deals" ? null : "DEMO-INV-2026-00045",
    customerName: "Acme Logistics Ltd",
    issueDate: "2026-10-05",
    dueDate: "2026-10-19",
    validUntil: "2026-10-19",
    closeDate: "2026-11-15",
    paymentType: o.paymentType ?? "Bank Finance",
    stage: "Negotiation",
    amount: 32_250_000,
    subtotal: 30_000_000,
    taxTotal: 2_250_000,
    total: 32_250_000,
    amountPaid: paid,
    balance: 32_250_000 - paid,
    model: "SUV Premium 2.0",
    colour: "Pearl White",
    vin: "DEMO0000000000001",
    engineNo: "ENG-000001",
    subject: "Test drive – SUV Premium",
    type: "Gate pass",
    status: "Issued",
    reference: "REF-001",
    currency: "NGN",
  };
  const field = (key: string, label: string, value: string) => ({ key, label, value, kind: "text" as const });
  const related = (key: string, title: string): PrintTable => ({ key, title, columns: [{ key: "number", label: "Number", align: "left" }, { key: "status", label: "Status", align: "left" }, { key: "total", label: "Total", align: "right" }], rows: [["DEMO-0001", "Open", "₦ 1,000,000.00"], ["DEMO-0002", "Paid", "₦ 2,500,000.00"]] });
  return {
    module,
    moduleLabel: module === "deals" ? "Deal" : module === "quotes" ? "Quotation" : module === "salesOrders" ? "Sales Order" : "Invoice",
    id: "sample-1",
    title: root.name,
    number: root.number,
    brandId: o.brandId ?? "demo",
    fields: [field("name", "Name", root.name), field("amount", "Amount", "₦ 32,250,000.00"), field("closeDate", "Close date", "15/11/2026"), field("paymentType", "Payment type", root.paymentType), field("stage", "Stage", "Negotiation"), field("type", "Type", "Gate pass"), field("status", "Status", "Issued"), field("reference", "Reference", "REF-001"), field("subject", "Subject", root.subject), field("owner", "Owner", "Femi Coker"), field("currency", "Currency", "NGN")],
    tables: [lines, related("invoices", "Invoices"), related("deals", "Deals"), related("payments", "Payments")],
    lines,
    totals: [
      { label: "Subtotal", value: "₦ 30,000,000.00", strong: false },
      { label: "VAT", value: "₦ 2,250,000.00", strong: false },
      { label: "Total", value: "₦ 32,250,000.00", strong: true },
      { label: "Paid", value: `₦ ${paid.toLocaleString("en-NG")}.00`, strong: false },
      { label: "Balance due", value: `₦ ${(32_250_000 - paid).toLocaleString("en-NG")}.00`, strong: true },
    ],
    terms: "Prices include VAT at 7.5 %. Goods remain the property of the seller until paid in full.",
    vin: root.vin,
    merge: {
      record: root,
      invoice: root,
      quote: root,
      deal: root,
      salesOrder: root,
      account: { name: "Acme Logistics Ltd", billingAddress: "12 Harbour Street\nApapa", city: "Lagos", phone: "+234 800 000 0001", email: "accounts@acme.example", tin: "12345678-0001" },
      contact: { name: "Ada Okafor", firstName: "Ada", email: "ada@acme.example" },
      owner: { name: "Femi Coker" },
    },
  };
}
