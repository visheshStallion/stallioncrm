# Print and e-mail guide

How printing, PDF and e-mail work in Stallion CRM: for users, for administrators, and for developers.
Both features follow the same rule as the rest of the application: **a record of a brand you cannot access does not
exist for you** – its printout, its PDF and its e-mail composer answer 404.

## 1. Printing

### For users

| Where | How | Result |
| --- | --- | --- |
| Any record (lead, contact, account, deal, quotation, sales order, invoice, activity, case, product, price book, campaign, inventory document, vehicle unit) | **Print** in the record header, or `Ctrl+P` / `⌘P` | Print preview in a new tab: choose template, paper (A4 / Letter), orientation; **Print** or **Download PDF** |
| Any list | **Actions → Print view** (or the *Print view* button) | The records shown on the page as a table |
| Selected records in a list | **Print / PDF** in the bulk bar | Background job; one merged PDF or a ZIP of separate PDFs under **Exports** (link valid 24 hours, at most 500 records) |
| Reports and dashboards | **Print / PDF** | The page with the letterhead; charts print as drawn |

**Which letterhead is used**

1. A record that belongs to a brand always prints on that brand's letterhead. It cannot be changed, not even through the address.
2. Shared records (accounts, contacts), lists and reports print as the company chosen under **Print as company** – only
   your own brands are offered (and *Group* for management). The default is the brand selected in the top bar.
3. A list with records of several brands prints on the group letterhead with a brand column.

Fields that are masked for you on screen (for example a phone number) print masked; hidden fields are not printed.
Printing a list or several records of customer modules needs the **export** permission; a single record only needs read access.

### For administrators

- **Setup → Brands → Letterhead** (`/setup/letterhead`): legal entity, RC number, address, phone, e-mail, website, VAT
  number, bank details, footer text, and whether documents print a **COPY** watermark after their first official
  print. The logo and brand colour come from the brand. A Brand Admin edits the own brand's letterhead only.
- **Setup → Customization → Print templates** (`/setup/print-templates`): the template designer. A template belongs
  to one module and to one brand or to all brands (all-brand templates: administrators only).
  - Blocks: letterhead, title, field grid (1–3 columns), rich text with merge fields, line items, related list,
    totals, terms, signature boxes, QR code, barcode, image, page break, footer.
  - The designer shows a live preview with a sample record. **Save draft** does not change what people print;
    **Publish** does and creates a version. Earlier versions can be put back. One template per module and brand can
    be the **default**.
  - Without a designed template every module prints with the built-in standard layout; quotations, sales orders,
    invoices, gate passes, test-drive indemnities and booking receipts have their own built-in layouts.
- **Setup → Customization → Print policy** (`/setup/print-policy`): a watermark per profile for lists and reports, for
  example `Internal – {user} – {date}`.
- Every print and PDF is in the audit trail (entity *Print*): who, module, record ids, template, letterhead, pages.

### Merge fields

`{{deal.name}}`, `{{account.name}}`, `{{brand.legalEntity}}`, `{{owner.name}}`, `{{vehicle.vin}}`, `{{today}}` …
The designer's **{ }** button lists the fields of the module.

| Syntax | Meaning |
| --- | --- |
| `{{contact.firstName \| "Customer"}}` | fallback when the field is empty |
| `{{quote.total \| currency}}` | ₦ with two decimals |
| `{{deal.closeDate \| date}}` | day/month/year |
| `{{deal.name \| upper}}` | capital letters |

Merge values come from the record **as the printing user sees it**. A field the user may not read stays empty.

## 2. E-mail

### Composer

**Send Email** in the header of a lead, contact, account, deal, quotation, sales order, invoice or case opens the composer.

- **From** is the sender address of the record's brand – it cannot be chosen. For shared customers you choose one of
  *your* brands. Replies go to you (Reply-To).
- **To / Cc / Bcc**: the record's customer is suggested; several addresses are separated by commas.
- **Template**: the brand's templates and group templates for this kind of record. Choosing one fills subject and
  text; both can still be changed.
- **Text**: blocks (text, hero image, two columns, vehicle card, button, divider, spacer, social links). The text
  editor has bold, italic, underline, strike, headings, size, colour, highlight, alignment, lists, links, tables,
  rule, images with alternative text, button, emoji, undo/redo. The **{ }** button inserts merge fields.
- The **brand layout** is added automatically: brand header, colour bar, footer with the legal entity and address.
- **Signature**: your signature for the brand (Setup → Personal Settings → E-mail signatures).
- **Attachments**: files you upload, documents of the record, and the record itself **as PDF** on the brand
  letterhead (any print template of the module). 10 MB in total.
- **Preview** (desktop and mobile width, merge fields resolved), **Send test to me**, **Save draft**,
  **Send later** (up to 90 days ahead; the e-mail goes out with your access at that time – if you lost access to the
  record it is not sent and you are notified), and an optional **follow-up task**.
- A sent e-mail is on the record's timeline (activity + message, brand-scoped) and in the audit trail (entity *Email*).

A **marketing** template is not sent to a customer who opted out of the brand's marketing. Service and transactional
e-mails about the customer's own business are not affected.

### Templates

**Campaigns → Templates → New e-mail template** (`/campaigns/templates/email/new`).

- Start from the **gallery**: enquiry follow-up, test-drive confirmation, quotation sent, booking confirmation,
  payment receipt, delivery appointment, thank you after delivery, service reminder, birthday, new model launch – or
  from an empty template.
- A template has an owner (a brand, or *Group*), a category (Sales, Service, Marketing, Transactional), the module it
  is offered on, and a folder.
- **Preview and check** shows the e-mail with sample values and runs the checks. Saving is refused for: merge fields
  that cannot be read, images without alternative text, an e-mail above 100 KB. Unknown merge fields are a warning.
  Marketing templates always get the per-brand unsubscribe link in the footer.
- Every save is a **version**; versions can be compared with the current text and restored. **Used by** lists the
  campaigns and workflow rules that use the template.
- Who may edit: the brand's manager, the brand's Brand Admin, administrators. Group templates: management.
  Templates of other brands are not visible.
- Workflow e-mails and campaigns use the same templates and the same renderer: a template designed here is sent in
  the brand layout by automation too.

## 3. Creating and using document templates

A **document template** is your company's format for a document – a tax invoice, sales order, quotation, proforma,
offer letter, booking receipt, gate pass – designed on a page and chosen when a record is sent, printed or downloaded.
Open **Document templates** from Setup → Customization, from Personal Settings, or from the e-mail composer
(`/templates/documents`).

### Create a template

1. **New document template** → choose a ready-made format (Tax Invoice, Proforma Invoice, Sales Order, Quotation,
   Booking Receipt, Deal Summary / Offer Letter, Delivery Note & Gate Pass, Test Drive Indemnity, Purchase Order,
   Customer Statement) or an empty page for any module.
2. Give it a name and say **who uses it**:

   | | Who creates it | Who publishes it | Who uses it |
   | --- | --- | --- | --- |
   | **Only me** (personal) | anyone | the author | the author – not for invoices, sales orders and inventory documents |
   | **Everyone in the brand** (shared) | the brand's manager, its Brand Admin, an administrator | the Brand Admin or an administrator; a brand manager **submits it for approval** | everyone in the brand |
   | **All brands** (group) | administrators | administrators | everyone – each document shows the letterhead of its own brand |

3. The **editor** shows the page (A4, Letter or A5; portrait or landscape; margins; zoom) with three regions:
   - **Header** – repeats on every page. The **company letterhead** sits here: logo, legal entity, RC number,
     address, phone, e-mail, website and VAT number come from the brand's letterhead (Setup → Brands → Letterhead).
     Choose the logo position (left, centre, right) and whether the details stand beside or below it.
   - **Body** – blocks added from the side panel and moved with the arrow buttons.
   - **Footer** – repeats on every page. A line with `{{page}}` / `{{pages}}` becomes the page number of the PDF.
4. **Save** keeps your working copy. **Preview** renders it on the server for a record you can open (choose it under
   *Preview with*); **Download test PDF** gives the same as a PDF marked PREVIEW.
5. **Publish** (or **Submit for approval**) makes it available. A published template keeps producing documents with
   its published version while you work on changes; publishing again creates the next version.

### Blocks

| Block | What it prints |
| --- | --- |
| Text | Free text: styles, lists, tables, images, colours (the brand colour is in the palette), merge fields |
| Document title & number | e.g. TAX INVOICE, the document number, date and due date |
| Bill to / Ship to | The customer of the record: name, address, phone, e-mail, TIN |
| Field grid | Any fields of the record in 1–3 columns |
| Line-items table | The items of the document; choose and order the columns (S/N, description, VIN, quantity, unit price, discount, amount), shaded rows; the column header repeats on every page |
| Totals | Subtotal, VAT, total, paid, balance – **always from the document, never typed** – and the amount in words (Naira and Kobo) |
| Payment details | The brand's bank details and your payment terms |
| Vehicle card | Model, variant, colour, VIN, engine number |
| Terms & conditions | The record's terms or your own text |
| Signature & stamp | Up to four signature lines and a box for the company stamp |
| QR code / Barcode | The record's address, the document number or the VIN |
| Conditional section | Text that prints only when a field has a value, e.g. *Payment type is Bank Finance*, *Balance is greater than 0* |
| Repeating section | Your own text once per row of a related list, with `{{row.…}}` fields |
| Related list table / Page break | A related list as a table; continue on a new page |

**Merge fields**: the side panel lists the fields of the module with a search box; a click copies one, and every text
block has the **{ }** button. Formats: `| date`, `| currency` (₦), `| usd`, `| number`, `| upper`, `| lower`,
`| title`, `| words`; default value `| "text"`; `{{amountInWords}}`, `{{today}}`. The preview lists unknown fields.

### Use a template

- **Send** on a quotation, sales order or invoice (and *Send Email* on any other record) opens the composer with
  **the document as PDF**: the brand's default template is preselected; the list offers the published templates of
  the record's brand, group templates and your personal ones. *Preview document* shows it before sending.
- On send the PDF is generated with your access, **stored as an exact copy** (with a checksum, the template and its
  version), attached, and logged on the record. An approved quotation becomes *Sent*; sales orders and invoices get
  their sent date.
- **Re-send**: the composer lists the copies made before. Choose one to attach the stored copy unchanged, or
  *Generate again with the current data*.
- **Print** and **Download PDF** on a record use the same template list; a downloaded PDF made with a document
  template is stored as a copy as well.
- **Bulk send**: select quotations, sales orders, invoices or deals in a list → **Send documents** → one template for
  all, one e-mail per customer (background job, needs the mass e-mail permission, at most 100 documents). The report
  under **Exports** says for every record whether it was sent, and why not.
- **Automation**: the workflow action **Send the document to the customer** sends the record with the brand's default
  template (or one named template) as the record's owner.
- **Default**: the Brand Admin or an administrator can make a published shared template the default of its module
  and brand; the brand's default comes before the group's.

### Rules

- A template never decides whose letterhead or whose data is printed. The record is loaded with **your** access
  (hidden record = not found, masked fields stay masked) and prints on the letterhead of **its own brand**.
- Templates of another brand are not listed, cannot be opened by address and cannot be used for a record.
- Official financial documents (invoices, sales orders, inventory documents) use shared, published templates only.
- Text and styles are sanitised: no scripts, frames, forms or remote styles; page styling is limited to font, size,
  line spacing and colour.
- A template with generated documents cannot be deleted, only archived. Stored copies cannot be changed.
- Every creation, change, approval, publication and use of a template, and every stored copy, is in the audit trail
  (entities *DocumentTemplate*, *GeneratedDocument*, *Print*, *Email*).

## 4. For developers

| Part | Where |
| --- | --- |
| Print engine | `src/server/modules/print` – `service.ts` (`renderPrintHtml`, `renderPrintPdf`, `renderListPrint`), `blocks.ts` (pure HTML renderer, print CSS, built-in templates), `describe.ts` (record → printable fields), `modules.ts` (loaders = the modules' own detail queries), `pdf.ts`, `bulk.ts` (job `print.bulk`) |
| Routes | `/print/{module}/{id}` (`?format=pdf`), `/print/list/{module}`, `POST /api/v1/print/bulk`, `POST /api/v1/print/preview` |
| E-mail | `src/server/modules/email` – `service.ts` (composer, drafts, job `email.scheduled`, signatures), `blocks.ts` (pure e-mail renderer), `templates.ts` (lint, versions), `starters.ts` |
| Document templates | `src/server/modules/doctpl` – `content.ts` (content model, `compileDoc`: a template + one record → a layout of the print engine; restricted CSS), `service.ts` (visibility, approval, publishing, stored copies), `starters.ts`, `bulk.ts` (jobs `document.bulkSend`, `document.send`); tables `DocumentTemplate`, `DocumentTemplateVersion`, `GeneratedDocument` (closed to user sessions; copies are immutable by trigger) |
| Shared | `messaging/merge.ts` (merge fields, fallbacks, formats), `print/sanitize.ts` (HTML sanitiser), `components/crm/RichTextEditor.tsx` (TipTap) |

- Data is loaded with the **user's** scoped client and field mask – there is no elevated read in either pipeline.
  The system stores in `src/server/db/print-store.ts` hold only configuration (letterheads, templates, drafts).
- **PDF engine**: `PRINT_PDF_ENGINE=chromium` renders the HTML with headless Chromium (Playwright; exact layout,
  embedded fonts). `basic` uses the built-in pdf-lib renderer (text, tables, letterhead – no rich layout). Without the
  variable Chromium is used when it is installed, otherwise `basic`. Serverless hosts without Chromium (Vercel) use
  `basic`; the browser's own print of the preview is always exact.
- E-mail HTML is table-based, 600 px wide, with inline styles only; images embedded in the editor are sent as inline
  attachments (`cid:`). All HTML passes the sanitiser: no scripts, iframes, forms, event handlers or `javascript:` links.

## 5. Known limits

- **Bulk e-mail from a list view** is not in the composer; mass e-mail goes through **Campaigns**, which use the same
  templates and renderer and enforce consent and suppression per brand.
- **Open and click tracking** is not implemented.
- Scheduled e-mails cannot carry files uploaded in the composer (record documents and the PDF printout can be attached).
- The designer and block editor move blocks with buttons (keyboard accessible), not by dragging.
- Print templates are HTML strings built by pure functions, not React server components; the sanitiser is
  `sanitize-html` and styles are written inline directly (no DOMPurify / juice) – same effect, fewer moving parts.
- The `basic` PDF engine does not reproduce designed layouts exactly (see above): with it the header is printed once
  and rich formatting of document templates is reduced to text. Use the Chromium engine for customer documents.
- Document templates: blocks are moved with buttons, not dragged; there is no .docx import, no text boxes, multi-column
  text, find & replace or copy-formatting; e-signature images and payment links / payment QR codes are not built
  (the QR block encodes the record's address, number or VIN); "also send via WhatsApp" is not offered.
- A document template's merge fields have two levels (`{{deal.name}}`, `{{account.name}}`); deeper paths such as
  `{{deal.vehicle.vin}}` are not resolved.
- In the workflow rule builder the document and e-mail template of "Send the document" are entered as ids
  (`default`, or `doc:` + the id in the template's address), not chosen from a list.
- Invoices have no "Sent" status: sending records the sent date on the invoice (and on sales orders); quotations move
  to *Sent*.
