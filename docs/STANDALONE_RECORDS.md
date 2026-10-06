# Standalone records and optional links

Leads, quotes, sales orders and invoices can be created **directly** – from their own list, Quick Create (+), the
mobile quick screen, a record template or the API – without first creating a deal, account, contact, product,
price book, quote, sales order or stock record. Links stay available and can be added later.

## What a record needs

| Record | Required | Filled automatically |
| --- | --- | --- |
| Lead | Brand, region, last name **or** company, mobile **or** e-mail | Brand (user's only brand), region (user's region) |
| Quote | Brand, region, customer name, one line (item name, quantity, price) | Number, status, dates, terms (brand's standard) |
| Sales order | Brand, region, customer name, one line | Number, status, expected delivery (+30 days) |
| Invoice | Brand, region, customer name, one line, invoice date | Number, status, invoice date (today), due date (+7 days) |

Brand and region are not "dependencies": the brand is the legal entity and the key of brand isolation, so every
record has both. A standalone record is visible exactly like a linked one (brand + region on the record).

## The customer on a document (bill-to)

Every quote, sales order and invoice keeps a **bill-to snapshot**: name, company, phone, e-mail, address, city, state
and TIN / VAT number. The document prints and e-mails from it, so it is complete without an account. The form has one
search box: type a name or phone to pick an existing customer you can see, or simply type the new customer. When the
phone belongs to a customer you can see, a hint offers to link it – linking is optional. Merge fields:
`{{billTo.name}}`, `{{billTo.phone}}` … in e-mail and document templates.

## Lines

Each line is a **product** of the document's brand (its price comes from the brand's price book; it can be changed
when permitted) **or a free-text item** (item name, optional item code and unit of measure, price typed). Brand
Managers and administrators can turn a free-text line into a product (**Save as product**). A vehicle line has a VIN
as free text; it moves stock only when the VIN is a stock unit of the brand. Totals and VAT are always calculated on
the server.

## Link later

On a document: **⋯ → Link to…** a deal, a customer (account / contact) or the source quote / sales order – records of
the same brand that you can open. Linking an account can update the bill-to. **Create customer from this document**
makes an account (and a contact for a person at a company) from the bill-to, or links the existing customer with the
same phone, e-mail or name. **Create deal from this quote** opens a deal at the Quotation stage. An issued invoice can
be linked, but its lines and amounts never change. Every link and unlink is in the audit trail.

## When links are missing

| Area | Behaviour |
| --- | --- |
| Visibility | Brand + region of the record, as always |
| Numbering | Unchanged: `{prefix}-{QT/SO/INV}-{year}-{00001}` per brand |
| Discount approval | Product lines: against the price-book maximum; free-text lines: the brand's % thresholds and an optional amount threshold (Dependencies) |
| Deal / Blueprint | A deal moves to Delivery only when one is linked |
| Conversion | Quote → Sales order → Invoice as before, and **Quote → Invoice directly** |
| Inventory | Stock moves only for units allocated through a deal; free-text VIN lines are "non-stock lines" |
| Payments | Recorded against the invoice |
| ERP posting | The ERP receives the bill-to (TIN, phone, name) to match its customer |
| Reports | Report source "Documents" with *Link status*; standard reports **Unlinked documents by brand** and **Non-stock vehicle lines**; list views "Unlinked …" |

## Dependencies (Setup → Customization → Dependencies)

Per brand, everything optional by default: require an account, a contact, a deal, a product on every line, a quote
before a sales order, a sales order before an invoice, a stock link for vehicle lines before an invoice is issued, and
the approval amount for discounts on free-text items. Rules apply to new documents; the page shows how many open
documents would not meet each rule. Administrators for every brand, Brand Admins for their own.

## API

| Call | Body |
| --- | --- |
| `POST /api/v1/leads` | `lastName` or `company`, `mobile` or `email`, `brandId`, `regionId` |
| `POST /api/v1/quotes`, `/salesOrders` (alias `/sales-orders`), `/invoices` | `billTo: { name, … }`, `lines: [{ description or productId, qty, unitPrice }]`, optional `brandId`, `regionId`, `issueDate`, `date`, `dealId`, `accountId`, `contactId`, `sourceDocumentId`, `priceBookId` |
| `POST /api/v1/{quotes, salesOrders, invoices}/{id}/link` | any of `dealId`, `accountId`, `contactId`, `sourceDocumentId` (null removes it), `refreshBillTo` |

Same scoping and validation as the screens: a record or link target of another brand answers 404 / 403.

## Known limits

- Documents have no campaign link; leads keep theirs.
- Inventory "Pick from stock" on a line is not offered; a VIN is typed and matched against the brand's stock units.
- The "Require …" rules are per brand for the three document types together, not per module.
- The quote / order / invoice form is online only on mobile (leads, calls and notes also work offline).
- The customer search covers name and phone; there is no inline "edit customer" pop-up.
