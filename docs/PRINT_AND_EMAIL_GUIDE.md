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

## 3. For developers

| Part | Where |
| --- | --- |
| Print engine | `src/server/modules/print` – `service.ts` (`renderPrintHtml`, `renderPrintPdf`, `renderListPrint`), `blocks.ts` (pure HTML renderer, print CSS, built-in templates), `describe.ts` (record → printable fields), `modules.ts` (loaders = the modules' own detail queries), `pdf.ts`, `bulk.ts` (job `print.bulk`) |
| Routes | `/print/{module}/{id}` (`?format=pdf`), `/print/list/{module}`, `POST /api/v1/print/bulk`, `POST /api/v1/print/preview` |
| E-mail | `src/server/modules/email` – `service.ts` (composer, drafts, job `email.scheduled`, signatures), `blocks.ts` (pure e-mail renderer), `templates.ts` (lint, versions), `starters.ts` |
| Shared | `messaging/merge.ts` (merge fields, fallbacks, formats), `print/sanitize.ts` (HTML sanitiser), `components/crm/RichTextEditor.tsx` (TipTap) |

- Data is loaded with the **user's** scoped client and field mask – there is no elevated read in either pipeline.
  The system stores in `src/server/db/print-store.ts` hold only configuration (letterheads, templates, drafts).
- **PDF engine**: `PRINT_PDF_ENGINE=chromium` renders the HTML with headless Chromium (Playwright; exact layout,
  embedded fonts). `basic` uses the built-in pdf-lib renderer (text, tables, letterhead – no rich layout). Without the
  variable Chromium is used when it is installed, otherwise `basic`. Serverless hosts without Chromium (Vercel) use
  `basic`; the browser's own print of the preview is always exact.
- E-mail HTML is table-based, 600 px wide, with inline styles only; images embedded in the editor are sent as inline
  attachments (`cid:`). All HTML passes the sanitiser: no scripts, iframes, forms, event handlers or `javascript:` links.

## 4. Known limits

- **Bulk e-mail from a list view** is not in the composer; mass e-mail goes through **Campaigns**, which use the same
  templates and renderer and enforce consent and suppression per brand.
- **Open and click tracking** is not implemented.
- Scheduled e-mails cannot carry files uploaded in the composer (record documents and the PDF printout can be attached).
- The designer and block editor move blocks with buttons (keyboard accessible), not by dragging.
- Print templates are HTML strings built by pure functions, not React server components; the sanitiser is
  `sanitize-html` and styles are written inline directly (no DOMPurify / juice) – same effect, fewer moving parts.
- The `basic` PDF engine does not reproduce designed layouts exactly (see above).
