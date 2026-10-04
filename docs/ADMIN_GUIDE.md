# StallionCRM – Admin guide

## Administering brands & users

Administration lives at **`/admin`** and is available only to users whose profile has the **Admin → edit**
permission (the *Administrator* profile). Everyone else gets *404 Not found* on every `/admin` page and
`/api/v1/admin/*` endpoint – the area is not revealed. Every change is written to the audit log.

### Brands (`/admin/brands`)
- **Create** a brand with code, name, legal entity, ERP company code, document prefix (used for quote / sales order /
  invoice numbers), colour (used by brand badges), status and Brand Manager. Creating a brand automatically creates
  its brand territory and one **“BRAND – Region”** territory per active region.
- **Code** is upper-case, 2–12 letters/digits, and **immutable once the brand has records**.
- **Logo**: upload PNG / JPEG / SVG / WebP up to 256 KB (stored in the database), or set a logo URL.
- **Status**
  - *Active* – normal.
  - *Future* – a reserved slot; it appears in the territory tree and can be prepared.
  - *Inactive* – no new records; existing records become **read-only**; the brand disappears from pickers and the
    brand switcher. Reactivate to edit again.
- **Brand Manager**: setting it makes the user manager (and a manager-member) of the brand territory, so they see the
  whole brand.
- **Code aliases**: legacy company codes from the HR rep file (SNMN, SNML → SNMNL; MG, SML → SMGL; THP → THPL;
  ZAHAV → ZANL …). They are used by the CSV user import. Add or remove them on the brand page.

### Regions (`/admin/regions`)
Add, rename or deactivate. **Adding** a region adds a “BRAND – Region” territory under every brand. **Renaming**
renames those territories. **Deactivating** keeps existing territories and records, but new brands no longer get a
territory for that region.

### Territories (`/admin/territories`)
Tree: *Group – All Brands* › *BRAND* › *BRAND – Region*.
- Set a **manager** per node (on a brand node this is the brand's Brand Manager).
- Open a territory to see **users in this territory**, add/remove members (optionally as manager).
- A territory that still has records (including soft-deleted ones) **cannot be deleted**. Use **Move records to…** to
  re-point all its records to another “BRAND – Region” territory (their brand/region change accordingly; audited),
  then delete. The root cannot be deleted; a brand node only when it has no children.
- *Territories of a user* are on the user page.

### Roles (`/admin/roles`)
Reporting hierarchy: Managing Director › Head of Sales › Brand Manager › Lagos Sales Exec; Head of Sales ›
Regional Sales Manager › Regional Sales Exec; CRM Administrator (outside the sales chart). Rename, re-parent (cycles
are rejected), add, or delete roles that have no users and no sub-roles. Roles do **not** grant visibility.

### Profiles (`/admin/profiles`)
The five profiles (Management, Administrator, Brand Manager, RSM, Sales Exec) carry permissions only – a brand is
never encoded in a profile.
- **Permission grid**: modules × read / create / edit / delete / export / massUpdate / approve, plus **scope**
  (*ALL* = every brand and region; *TERRITORY* = own territories). Changes apply on each user's next request.
- **Field-level security** tab: per module and field – *Editable*, *Read-only*, *Masked* (e.g. phone `0803****21`) or
  *Hidden*.
- **New profile** clones an existing one.
- The system refuses any change that would leave **no active administrator**.

### Users (`/admin/users`)
- Create / edit name, email, role, profile, manager and (optional) password. Users without a password sign in with
  Microsoft SSO (if configured), matched by email.
- **Territories** are chosen in a brand × region grid. The **Quick assign** helper computes them:
  | Role | Territories |
  |---|---|
  | Lagos Sales Exec + brands [HMNL, THPL] | HMNL – Lagos, THPL – Lagos |
  | Regional Sales Exec, Abuja + brands | every chosen “X – Abuja” |
  | Brand Manager + brand | the brand-level territory, as manager |
  | Regional Sales Manager | every non-Lagos brand-region territory, as manager |
  | Management / Administrator | Group – All Brands |
- **What can this user see?** shows the brand × region matrix computed by the access engine (plus records the user
  owns).
- **Deactivate**: the page previews the reassignment first – each open record (e.g. deals not closed) goes to the
  Brand Manager of the record's brand. Records whose brand has no (active) Brand Manager stay with the user and are
  listed as a problem. You cannot deactivate yourself or the last administrator.
- Changes to territories, profile or status take effect on the user's **next request** (the access context is
  rebuilt per request; nothing is cached across requests).

### CSV import (`/admin/users/import`)
Columns: `name, email, company_codes, role, region`.
- `company_codes` is the comma-separated legacy list (e.g. `"HMNL, MG, SNML"`), resolved through the code aliases and
  de-duplicated (“HMNL, SNML, SNMN” → HMNL + SNMNL).
- `role` accepts the role names or common aliases (`Sales Exec` resolves to Lagos / Regional by region, `BM`, `RSM`,
  `MD` …). The profile follows from the role.
- Always a **dry run** first: brands resolved, territories to assign, unknown codes, rows without a company (flagged
  “Confirm licence”), multi-brand reps, new vs existing users and errors.
- **Import** applies OK rows plus flagged rows you tick; error rows are never imported. Existing users (same email)
  get role, profile and territories updated.
- The file is read in your browser and processed in memory – it is **never stored**. Never commit real rep files to
  the repository.

### Audit log (`/admin/audit`)
Filter by user, entity, brand and date; **Export CSV** downloads the filtered log (the export itself is audited).

## Leads

### Working with leads (`/leads`)
- **Views**: *Open leads*, *My open leads*, *Hot leads this week*, *All leads*, plus your own saved views (filters + visible
  columns – use **Columns** then **Save view**). Filters (status, source, rating, brand, region, owner, created date, search)
  narrow the selected view; brand / region filters only offer values you can see. List or **Kanban by status**.
- **Create**: brand is required (pre-filled when you sell one brand) and cannot be changed afterwards; region defaults to
  yours; the model picker shows only the chosen brand's models. Mobile numbers are stored in E.164 (`0803…` → `+234803…`).
- **Duplicate check** (mobile / email): matches in the same brand are shown with a link; a match in another brand (or one
  you cannot see) only shows “Customer exists – link instead”, without details.
- **Owner**: a lead can only be owned by an active user who works in its brand and region – other choices are rejected.
- **Mass actions** (profiles with *mass update*): change owner (one brand at a time) and set status. **Export** is only
  shown to profiles with the *export* permission and is audited.
- **Convert**: creates or links the shared Account and Contact, creates a Deal with the lead's brand, region, model and
  owner, and marks the lead *Converted* (read-only).
- **Timeline**: field history of the lead (activities and emails arrive with later modules).

### Assignment rules (`/admin/assignment-rules/leads`)
Ordered rules – the first active rule whose criteria (brand, region, source, model; empty = any) match decides the owner:
- *Round-robin in Brand–Region territory* – rotates over the active, non-manager members of the lead's territory; the
  position is stored per rule.
- *Specific user* – used only if that user is active and works in the lead's brand-region.
- *Territory manager*.

If a rule finds nobody, or no rule matches: round-robin in the territory → territory manager → Brand Manager. The seed
ships one catch-all round-robin rule. Rules apply to web leads and to leads created with *Assign automatically*.

### Web-to-Lead (`/admin/web-forms`)
Each brand has a public endpoint `POST /api/public/leads/<BRAND>` and a copy-paste HTML snippet (region pick-list,
consent box, UTM capture). The brand is taken from the URL only – a form for one brand can never create another brand's
lead. Protection: hidden honeypot field, per-IP rate limit (`WEB_LEAD_RATE_LIMIT`, default 10 per 10 minutes) and
optional reCAPTCHA (`RECAPTCHA_SECRET_KEY`; send `recaptchaToken`). WhatsApp / Facebook use the same endpoint with
`?channel=whatsapp|facebook`; those adapters are stubs (501) until the providers are configured.

## Customers (Accounts & Contacts)

Customers are **shared across brands** – one record per person or company – while deals, quotes, orders and cases stay
with their brand.

### What each user sees
| You … | You see |
|---|---|
| have no record with the customer | name, type, city, industry and a masked phone (`+234****21`) |
| can access at least one deal (or other record) of the customer, or you created the customer | also phone, email, address, date of birth, notes |
| are Management / Administrator, or the Brand Manager of a brand the customer buys | also credit limit, KYC status and RC number |

Searching by a **full phone number** finds the customer for everyone, but the result stays masked. Related lists
(Deals, …) and the “Brands this customer buys” chips only ever show what you can access – there is no count of other
brands' records. The same masking applies in the API and in exports (export needs the *export* permission).

### Duplicates
- When creating an account, possible matches (same phone, email or RC number, or a similar name in the same city) are
  shown so you can open the existing customer instead.
- Converting a lead **reuses** an existing customer with the same mobile or email.
- **Accounts → Actions → Find & merge duplicates** (Administrators and Management only): pick the record to keep; the
  others are merged into it. Contacts and all deals / quotes / orders / cases of every brand move to the kept record,
  empty fields are filled from the duplicates, the duplicates are archived and everything is audited.

### Marketing consent
Recorded **per brand** on the contact page. Opting out of one brand does not opt the customer out of another. Users can
set consent only for the brands they work in. A lead's consent is carried over for the lead's brand when it is converted.

## Deals, pipelines & Blueprint

### Working with deals (`/deals`)
- **List or Kanban.** The pipeline picker lists only pipelines of your brands; “All my brands” shows one board per brand.
  Column headers show the number of deals and their total; cards carry the brand stripe and a **Stale** badge when a
  deal has been in its stage longer than the stage allows. Views, filters and saved views work as in Leads.
- **Moving a deal** (drag a card, or the *Next step* buttons on the deal): you can move to the previous or next stage,
  or to *Closed Lost*. Managers of the brand can jump to any stage. If the target stage needs information the deal does
  not have yet, a dialog asks for it:
  | Stage | Needed to enter |
  |---|---|
  | Test Drive | test drive date, model |
  | Quotation | a quote exists (enforced once Quotes are live) |
  | Booking | deposit amount, deposit receipt no. |
  | Delivery | VIN / chassis no. (unique per brand), delivery date |
  | Closed Lost | loss reason |
- **Brand** is set when the deal is created and cannot be edited (brand changes go through approval). **Region** can be
  changed by managers only. The **owner** must be someone who works in the deal's brand and region.
- **Notes and attachments** (PDF, images, Word / Excel, text; up to 10 MB) belong to the deal's brand – users of other
  brands cannot see or download them. The **Timeline** tab shows stage history (with time spent per stage) and field
  changes.

### Pipelines & Blueprint setup (`/admin/pipelines`)
Per brand: rename stages, set the win probability and the “stale after N days” limit, choose which fields are required
to enter a stage, and optionally restrict which stages can follow. Add extra open stages or remove unused ones (the
standard stages and stages that contain deals cannot be removed).

## Products & price books

- **Who sees what**: users see the products, price books and stock of the brands they work in – never another brand's.
  Management and administrators see all brands.
- **Who can change them**: the **Brand Manager** of a brand (own brand only) and administrators. Everyone else is
  read-only.
- **Products** (`/products`): grid or list, filters for model, category, active and more. A product has a code (unique
  per brand), model, variant, year, specification, colours, list price, tax (VAT 7.5 % by default), image URLs and a spec
  sheet link. Deactivate a product to hide it from pickers; the brand of a product never changes.
- **Price books** (`/priceBooks`): each has a validity period and may be the brand's **default**. Only one default
  price book per brand can be valid at a time – an overlapping default is rejected. A product's current price is the
  entry in the default book valid today, otherwise its list price. Entries carry a **max discount %** used later by
  discount approvals.
- **CSV import / export** on the price book page: columns `code, price, max_discount_pct, notes`. The dry run lists
  unknown codes (codes must be products of the same brand), duplicates and invalid numbers; only valid rows are imported.
- **Vehicle stock** (on the product page): add VINs with colour, location and status. On a deal, *Reserve a vehicle*
  attaches an available vehicle of the deal's brand (and model); the reservation is released automatically when the deal
  is Closed Lost and the vehicle is marked sold on Closed Won.

## Quotes, sales orders & invoices

- **Create a quote** from a deal (*Create Quote*). It takes the deal's brand, region, customer, model, quantity and the
  current price book price; brand and region cannot be changed on the document. Numbers are issued automatically per
  brand: `HMNL-QT-2026-00001`, `HMNL-SO-…`, `HMNL-INV-…`.
- **Edit** lines while the document is a draft: product (only the brand's products), quantity, price, discount % and
  VAT. Totals are calculated by the system.
- **Discounts and approval**: a line discount above the price book's maximum, or any discount above the brand's
  threshold (3 % by default), sends the quote to the **Brand Manager** for approval when you submit it; above the
  escalation threshold (7 % by default) to the **Head of Sales**. The quote cannot be sent or accepted until it is
  approved; a rejected request returns it to draft. Thresholds are set per brand in *Setup → Brands*.
- **From quote to cash**: Submit → Mark as Sent → Accepted by customer → *Create Sales Order* → Confirm → *Allocate VIN*
  (needs a vehicle reserved on the deal) → Mark Delivered (updates the deal and moves it to Delivery) → *Create Invoice*
  → Issue → record payments (deposit / balance) until the invoice is Paid. A deal can have several quotes, but only one
  accepted.
- **PDF**: every document prints on the brand's template – logo, legal entity, address, bank details and terms from
  *Setup → Brands*.
- Users of other brands cannot open, print or list these documents.

## Automation (Setup → Automation)

- **Workflow rules** – create a rule: choose the module, the trigger, an optional brand scope, the criteria and
  the actions. Use `{{name}}` in task subjects and notification titles to insert the record name. Deactivate a
  rule instead of deleting it when you may need it again.
- **Approval processes** – switch a process on or off and set "auto-approve after N hours" per step. Discount
  thresholds A and B are set per brand in **Brands**.
- **Automation run log** – every rule run with its result, attempts and last error. Failed runs are retried
  automatically (up to 5 times); use **Retry** for dead jobs and **Run scheduler now** to evaluate scheduled rules
  immediately.
- The scheduler must call `POST /api/public/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
- A record with a pending approval is locked for everyone except administrators. Requests can be recalled by
  the requester from the record page.

## Analytics permissions

- **Reports** – `read` opens reports, `create` / `edit` allow building own reports, `export` allows CSV / XLSX
  export (every export is in the audit log with its row count). The Sales Exec profile has no export.
- **Forecasts** – `edit` lets Management and Brand Managers set targets and add forecast notes; a Brand Manager
  can only do this for the brand they manage.
- Sharing a report (Brand or Group folder) never widens access: every viewer sees only their own records.
- Existing installations: review the Reports / Forecasts rows of your profiles after this update (the seeded
  defaults only apply to a fresh database).

## Messaging and campaigns

1. **Provider credentials** go into the server environment (see `.env.example`): choose the email, SMS and
   WhatsApp provider and set their keys. Nothing is delivered until a provider is configured (sandbox).
2. **Sender identity** – Setup → Brands → each brand: from-name and from-address, SMS sender ID, the number that
   receives SMS replies, the WhatsApp Business number and its phone-number ID. A brand without a sender cannot
   send on that channel.
3. **Webhooks** – point the providers at `/api/public/webhooks/whatsapp`, `/api/public/webhooks/sms?token=…` and
   `/api/public/webhooks/email?token=…` and set `MESSAGING_WEBHOOK_SECRET` / `WHATSAPP_APP_SECRET` /
   `WHATSAPP_VERIFY_TOKEN`. Inbound messages are routed by the number that received them.
4. **Permissions** – the Campaigns row of a profile: `read`, `create`, `edit`, and **mass email** (required to
   launch; Brand Manager and above by default).
5. **Consent** is per brand. Campaigns only reach people with marketing consent for the campaign's brand;
   everyone else is listed as suppressed with the reason. Unsubscribe links and "STOP" replies opt out of that
   brand only.
6. The scheduler tick (`/api/public/cron/tick`) sends queued campaign batches.

## Cases

- **SLA & calendar** (Cases → SLA & calendar): each brand's manager sets first-response and resolution hours per
  priority and the role that is told when a case breaches. Administrators set the working days, opening hours
  and public holidays (add movable holidays such as Eid and Easter every year).
- **Escalation** needs the scheduler tick (`/api/public/cron/tick`) and the workflow rule "Case breaching its SLA"
  (Setup → Workflow rules) to be active.
- **Assignment** of cases from the web form uses assignment rules with module `cases`; without rules it is
  round-robin among the members of the brand-region territory.
- **Public form**: `POST /api/public/cases/<BRAND CODE>` with `name`, `subject`, `message` and optional `phone`,
  `email`, `type`, `region`, `vin`.
- **Solutions**: brand managers write articles for their brand; management and administrators write group articles.


## Import, export & customization

- **Import data** (Setup → Data Administration → Import data): see [MIGRATION_FROM_ZOHO.md](MIGRATION_FROM_ZOHO.md).
  Administrators import into any brand, Brand Managers into their own. Always read the dry run before starting;
  an import can be undone from the history.
- **Exports** (`/exports` or "Export view" on a list): allowed by the `Export` permission of the profile per
  module. Large exports are prepared in the background (needs the scheduler tick); links expire after 24 hours.
- **Full backup** (`/exports`, administrators): choose a passphrase of at least 12 characters and keep it in the
  password manager – it is not stored and the file cannot be opened without it. Decrypt with
  `pnpm backup:decrypt <file.zip.enc> <out.zip>`.
- **Custom fields** (Setup → Fields & layouts): key, module, type and brand cannot change after creation;
  deactivate a field instead of deleting it (values are kept). Brand-specific fields exist only on that brand's
  records. Use "Index" for fields that are filtered often on large modules. Set who may see or edit a field in
  Setup → Profiles → Field permissions (key `cf_…`).
- **Layouts**: one default per module plus optional brand variants. Notation, one item per line –
  sections `Title: cf_a, cf_b`; rules `REQUIRE cf_financeBank WHEN paymentType eq FINANCE`
  (actions SHOW, HIDE, REQUIRE; operators eq, neq, in, isEmpty, notEmpty, gt, lt).

## API, webhooks & integrations (Setup → Developer Space)

See [API.md](API.md) for the integrator's view.

- **Integration principals**: create one per external system and per purpose, with the narrowest profile and
  only the brands it needs (e.g. "ERP connector HMNL" → HMNL). A principal cannot sign in; deactivate it under
  Users to cut an integration off at once.
- **Tokens**: the token is shown once – store it in the other system's secret store. Give tokens an expiry,
  revoke unused ones (the list shows "last used"). Users manage their own tokens under avatar → My API tokens;
  administrators see and can revoke all of them.
- **OAuth clients**: for systems that support the client-credentials grant; disabling a client revokes its tokens.
- **Webhooks**: choose the principal deliberately – it decides which records and fields leave the CRM. Use the
  brand filter for brand-specific receivers. Watch the delivery log; "Skipped" means the principal may not see
  the record.
- **ERP**: set each brand's ERP company code (Setup → Brands) before switching the adapter on. Failed postings
  are in the automation run log (job type `erp.post`) and can be retried there.
- **Payments**: keys are per brand (`PAYSTACK_SECRET_KEY_<BRAND>`); a brand without a key has no payment-link button.

## Inventory

See [INVENTORY_GUIDE.md](INVENTORY_GUIDE.md). For administrators:

- **Users**: inventory staff get the profile *Inventory Officer*, *Logistics* or *Inventory Finance* and the brand
  territory (e.g. `HMNL`). The roles Stock Controller, Logistics Officer and Brand Accountant are seeded; create
  them under Setup → Roles on an existing installation if they are missing (the profiles are added by the
  migration).
- **Per brand** (Inventory → Settings): warehouses, vendors, reservation period, approval limits, valuation of
  parts, PDI checklist, account mapping and the period lock date. A shared yard is one warehouse per brand.
- **Scheduler**: reservation expiry runs on the tick (`/api/public/cron/tick`).
- **Existing data**: the stock references of earlier versions became vehicle units without cost or warehouse;
  receive real stock through goods receipts.
