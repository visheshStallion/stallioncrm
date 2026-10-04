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
