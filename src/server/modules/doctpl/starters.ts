/**
 * Starter gallery of document templates (prompt 21 §3): copy-and-edit formats for vehicle sales. Our own wording and
 * layout; pure data. Every starter is a normal template content that the editor opens.
 */
import type { DocBlock, DocContent } from "./content";

export interface DocStarter {
  key: string;
  name: string;
  description: string;
  /** print module key */
  module: string;
  paper: "A4" | "LETTER" | "A5";
  content: DocContent;
}

const LINES = ["sn", "description", "productName", "vin", "quantity", "unitPrice", "discountPct", "lineTotal"];
const FOOT = "<p>Page {{page}} of {{pages}}</p>";
const page = (body: DocBlock[], footer = FOOT, header = ""): DocContent => ({ letterhead: { show: true, logo: "left", details: "beside" }, header, body, footer });
const rich = (html: string): DocBlock => ({ type: "rich", html });
const title = (text: string): DocBlock => ({ type: "title", text, showNumber: true, showDates: true });
const sign = (...roles: string[]): DocBlock => ({ type: "signatures", roles, stamp: true });
const items: DocBlock = { type: "lineItems", columns: LINES, zebra: true };

export const DOC_STARTERS: DocStarter[] = [
  {
    key: "tax-invoice",
    name: "Tax Invoice",
    description: "Invoice with VAT, amount in words, bank details and balance due",
    module: "invoices",
    paper: "A4",
    content: page(
      [
        title("TAX INVOICE"),
        { type: "parties", shipTo: false },
        items,
        { type: "totals", words: true },
        { type: "conditional", field: "balance", op: "gt", value: "0", html: "<p><strong>Balance due: {{invoice.balance | currency}}</strong> – please quote the invoice number {{invoice.number}} with your payment.</p>" },
        { type: "payment", terms: "Payment is due by the date shown above." },
        { type: "terms" },
        sign("Customer", "Accounts"),
      ],
      `<p>{{brand.legalEntity}} · This is a computer-generated invoice.</p>${FOOT}`,
    ),
  },
  {
    key: "proforma-invoice",
    name: "Proforma Invoice",
    description: "Proforma for bank finance or advance payment, with validity note",
    module: "quotes",
    paper: "A4",
    content: page([
      title("PROFORMA INVOICE"),
      { type: "parties", shipTo: false },
      { type: "vehicle" },
      items,
      { type: "totals", words: true },
      { type: "payment", terms: "This proforma is valid until {{quote.validUntil | date | \"the date agreed\"}}. Prices are subject to change after that date." },
      rich("<p>This is not a tax invoice. A tax invoice is issued when payment is received.</p>"),
      sign("Sales Executive", "Brand Manager"),
    ]),
  },
  {
    key: "sales-order",
    name: "Sales Order",
    description: "Order confirmation with items, totals and both signatures",
    module: "salesOrders",
    paper: "A4",
    content: page([title("SALES ORDER"), { type: "parties", shipTo: true }, items, { type: "totals", words: false }, { type: "terms" }, sign("Customer", "Sales Executive", "Brand Manager")]),
  },
  {
    key: "quotation",
    name: "Quotation",
    description: "Offer with a personal introduction, items and validity",
    module: "quotes",
    paper: "A4",
    content: page([
      title("QUOTATION"),
      { type: "parties", shipTo: false },
      rich(`<p>Dear {{contact.firstName | "Customer"}},</p><p>Thank you for your interest in {{brand.name}}. We are pleased to offer you the following:</p>`),
      items,
      { type: "totals", words: true },
      rich(`<p>This quotation is valid until {{quote.validUntil | date | "the date agreed"}}.</p><p>Kind regards,<br>{{owner.name}}</p>`),
      { type: "terms" },
    ]),
  },
  {
    key: "booking-receipt",
    name: "Booking Receipt",
    description: "A5 receipt for a booking deposit on a deal",
    module: "deals",
    paper: "A5",
    content: page(
      [
        { type: "title", text: "BOOKING RECEIPT", showNumber: false, showDates: true },
        rich(`<p>Received from <strong>{{deal.customerName | "the customer"}}</strong> a booking deposit for:</p>`),
        { type: "vehicle" },
        { type: "fields", columns: 1, fields: ["name", "amount", "closeDate"] },
        rich("<p>The deposit is applied to the purchase price. This receipt is not proof of ownership.</p>"),
        { type: "signatures", roles: ["Customer", "Sales Executive"], stamp: false },
      ],
      "",
    ),
  },
  {
    key: "deal-offer-letter",
    name: "Deal Summary / Offer Letter",
    description: "A letter that summarises the deal for the customer or their bank",
    module: "deals",
    paper: "A4",
    content: page([
      rich(`<p>{{today}}</p><p><strong>{{deal.customerName | "Dear Customer"}}</strong></p><h2>Offer: {{deal.name}}</h2><p>Dear {{contact.firstName | "Customer"}},</p><p>Following our discussion we are pleased to confirm our offer:</p>`),
      { type: "vehicle" },
      { type: "fields", columns: 2, fields: ["amount", "closeDate", "paymentType", "stage"] },
      { type: "conditional", field: "paymentType", op: "eq", value: "Bank Finance", html: "<p><strong>Bank finance:</strong> this offer may be presented to your bank. We will release the vehicle when the bank confirms payment.</p>" },
      rich(`<p>We look forward to welcoming you to {{brand.name}}.</p><p>Yours sincerely,<br>{{owner.name}}<br>{{brand.legalEntity}}</p>`),
    ]),
  },
  {
    key: "delivery-note-gate-pass",
    name: "Delivery Note & Gate Pass",
    description: "Releases a vehicle from the yard; barcode of the document number",
    module: "inventoryDocuments",
    paper: "A4",
    content: page([
      title("DELIVERY NOTE / GATE PASS"),
      { type: "fields", columns: 2, fields: ["type", "status", "warehouse", "reference", "date", "notes"] },
      items,
      rich("<p>The vehicle(s) listed above left the premises in good condition, with all accessories and documents.</p>"),
      { type: "barcode", value: "number" },
      sign("Released by", "Security", "Received by"),
    ]),
  },
  {
    key: "test-drive-indemnity",
    name: "Test Drive Indemnity",
    description: "Declaration signed by the customer before a test drive",
    module: "activities",
    paper: "A4",
    content: page([
      { type: "title", text: "TEST DRIVE INDEMNITY", showNumber: false, showDates: false },
      { type: "fields", columns: 2, fields: ["subject", "startAt", "owner", "location"] },
      rich(
        "<p>I confirm that I hold a valid driving licence and will drive the vehicle with care and within the law.</p><ol><li>I am responsible for traffic offences committed during the test drive.</li><li>I will follow the route and instructions of the accompanying sales executive.</li><li>I accept liability for damage caused by my negligence.</li></ol>",
      ),
      { type: "signatures", roles: ["Customer (name, licence no., signature)", "Sales Executive"], stamp: false },
    ]),
  },
  {
    key: "purchase-order",
    name: "Purchase Order",
    description: "Order to a vendor from the inventory module",
    module: "inventoryDocuments",
    paper: "A4",
    content: page([title("PURCHASE ORDER"), { type: "fields", columns: 2, fields: ["vendor", "warehouse", "date", "reference", "currency"] }, items, { type: "totals", words: true }, rich("<p>Please quote the purchase order number on all deliveries and invoices.</p>"), sign("Prepared by", "Approved by")]),
  },
  {
    key: "customer-statement",
    name: "Customer Statement",
    description: "An account's open documents and recent activity",
    module: "accounts",
    paper: "A4",
    content: page([
      { type: "title", text: "CUSTOMER STATEMENT", showNumber: false, showDates: false },
      { type: "parties", shipTo: false },
      rich("<p>Statement as of {{today}}.</p>"),
      { type: "related", list: "invoices", title: "Invoices" },
      { type: "related", list: "deals", title: "Deals" },
      { type: "payment" },
    ]),
  },
];

export const docStarter = (key: string) => DOC_STARTERS.find((s) => s.key === key);
