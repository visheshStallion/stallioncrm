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
