# StallionCRM – Architecture

> Read [`BUSINESS_CONTEXT.md`](BUSINESS_CONTEXT.md) first. This document explains how the rules there are
> enforced in code, and the conventions every module (prompts 01–15) must follow.

## 1. Stack

| Concern | Choice |
|---|---|
| Web | Next.js 15 App Router, React 19 Server Components + Server Actions, TypeScript strict |
| Data | PostgreSQL 16, Prisma 6, **Postgres Row-Level Security** |
| Auth | Auth.js v5 – credentials (argon2id) + optional Microsoft Entra ID SSO; JWT holds the user id only |
| UI | Tailwind CSS 4, shadcn/ui-style components (`src/components/ui`), TanStack Table |
| Validation / logs | Zod, pino |
| Tests | Vitest (unit + integration against real Postgres), Playwright (E2E) |
| Tooling | pnpm, docker compose (Postgres + Mailpit), GitHub Actions |

## 2. Repository layout

```
docs/                 BUSINESS_CONTEXT.md, ARCHITECTURE.md, adr/
prisma/               schema.prisma, migrations/, rls/*.sql (RLS source of truth), seed.ts + seed-data.ts (fictitious)
scripts/              local-db.ts (Docker-free Postgres), e2e-server.ts, lib/embedded-pg.ts
src/app/              (auth)/login, (crm)/… pages, api/v1/… route handlers
src/server/access/    visibility + permission engine – the ONLY place access rules live
src/server/db/        unsafe client (lint-restricted), scopedDb, RLS session setter, audit(), system queries
src/server/modules/   one folder per module: schema.ts, queries.ts, service.ts, actions.ts
src/server/request.ts per-request access context (session → AccessContext), UI filters
src/server/api.ts     apiHandler / safeAction – error → HTTP status / toast mapping
src/components/       shared UI: DataTable, RecordForm, BrandBadge, RegionBadge, Kanban, Toaster, ui/*
tests/                unit/, integration/, e2e/, fixtures/, support/
```

## 3. Brand isolation – defence in depth

```
 request ─► middleware (session exists?) ─► requireContext() ─► AccessContext
                                                         │
             module service: zod ─► assertCan(ctx, module, action, record)   ← profile permissions
                                                         │
                                  scopedDb(ctx) Prisma extension               ← layer 1 (row scope)
                                                         │  BEGIN; SET LOCAL ROLE stallion_rls; set_config(app.*)
                                  PostgreSQL RLS policies                       ← layer 2 (row scope)
```

### 3.1 AccessContext (`src/server/access/context.ts`)
`getAccessContext(userId)` (request-cached with React `cache`) returns
`{ userId, user, scope, profile{permissions, fieldPermissions}, memberships[{territoryId, brandId, regionId|null, isManager}], brandIds, isAdmin }`.
The root territory is omitted from `memberships` – it grants nothing; `scope = ALL` comes from the profile.
Inactive users get `null` → redirected to `/login` (UI) or 401 (API) on their next request.

### 3.2 Visibility rule (`visibility.ts`)
`brandScopeWhere(ctx)`: scope ALL → `{}`; otherwise
`OR[ {ownerId: me}, {brandId: B} (brand-level membership), {brandId: B, regionId: {in: [...]}} … ]`.
`isVisible(ctx, record)` is the same rule in memory; `canWriteTo(ctx, brand, region)` is the rule **without** the
owner clause – ownership never lets you create/move a record into a territory you don't belong to.

### 3.3 Permissions (`can.ts`)
`can(ctx, module, action, record?)` = profile permission **and** (create → `canWriteTo`; other actions → `isVisible`).
`assertCan` throws `NotFoundError` (404) when the record is not visible – never 403 – so other brands' records are
not revealed; `ForbiddenError` (403) when visible but not permitted. `apiHandler` maps these to HTTP; server actions
use `safeAction` and the UI shows a toast (`toastResult`).

### 3.4 Field-level security (`field-mask.ts`)
`Profile.fieldPermissions[module][field] ∈ hidden | masked | read | edit` (default edit).
`fieldMask(ctx, module, record)` removes hidden fields and masks masked ones (`08031234521 → 0803****21`).
Apply it in `queries.ts` before returning shared-customer data (prompt 03 adds the "can see one of the customer's
brand records" upgrade).

### 3.5 `scopedDb(ctx)` (`src/server/db/scoped.ts`) – layer 1
A Prisma client extension over **every** operation:

| Operation | Behaviour on brand-owned models |
|---|---|
| findMany/First, count, aggregate, groupBy, updateMany, deleteMany | `where = AND(where, scope, deletedAt: null)` |
| findUnique(OrThrow), update, delete, upsert | scope appended to the unique `where` (`AND`) |
| create / createMany / upsert.create | brandId + regionId mandatory scalars, must pass `canWriteTo`; `territoryId = resolveTerritory()`; `createdById/updatedById` stamped |
| any write to a record of an INACTIVE brand, or create in one | rejected (bulk writes skip such records) |
| create / update setting `ownerId` (incl. updateMany) | the owner must be an active user with territory access to the record's brand-region |
| update moving brandId / regionId | re-validated; **brand change requires scope ALL** (others → brand-change approval, prompt 08); territory re-resolved |
| updateMany touching brand/region | rejected |
| include / select / `_count` of list relations to brand-owned models (any depth) | scope injected into the relation `where` |
| nested create/update/delete/upsert/set INTO a brand-owned relation | rejected – use that model's own client |
| create / update / delete / upsert | `audit()` entry with before/after |

Brand-owned models are **detected from the Prisma schema** (`brand-owned.ts`: any model with scalar
`brandId + regionId + ownerId`). Nothing to register.

Limitation: each operation runs in its own short transaction, so interactive `$transaction(async tx => …)` is not
available on the scoped client. Use sequential calls or the batch form; add a scoped-transaction helper when a module
genuinely needs one.

### 3.6 Postgres RLS – layer 2 (`prisma/rls/*.sql`)
* NOLOGIN role **`stallion_rls`** (no BYPASSRLS). Every scopedDb operation (including `$queryRaw`) runs as
  `BEGIN; SET LOCAL ROLE stallion_rls; SELECT set_config('app.user_id'|'app.scope'|'app.memberships', …, true); <query>; COMMIT`.
  `LOCAL` settings die with the transaction, so pooled connections never carry another user's context.
* Functions `app_can_read(brand, region, owner)` / `app_can_create(brand, region)` mirror `visibility.ts`.
  Missing settings ⇒ no rows (fail closed).
* `app_enable_brand_rls('"Table"')` creates policies `brand_read` (SELECT), `brand_insert` (INSERT, create rule),
  `brand_update` (USING + WITH CHECK read rule), `brand_delete`.
* `stallion_rls` has **no** access to `AuditLog` or `_prisma_migrations` and cannot SELECT `User.passwordHash`
  (column grants). The unscoped client also omits `passwordHash` globally; only `findUserForLogin` opts in.
* The connection role (table owner) bypasses RLS – that is the system path used by the seed, migrations,
  `audit()` and the narrow queries in `src/server/db/system.ts`.
* The migration `20261004000100_rls` is the concatenation of `prisma/rls/*.sql`; `tests/unit/rls-migration.test.ts`
  fails if they drift. **Never edit an applied migration** – add new SQL to `prisma/rls/` *and* to a new migration.

### 3.7 The unsafe client
`src/server/db/unsafe.ts` is the only `PrismaClient`. ESLint `no-restricted-imports` blocks importing it (or
`PrismaClient` from `@prisma/client`) anywhere except `src/server/db/**`, `prisma/**`, `scripts/**`, `tests/**`
(`tests/unit/lint-unsafe-import.test.ts`). If application code needs a system-level query (no user context), add a
narrow, named function to `src/server/db/system.ts` and justify it in review.

## 4. Territories (`src/server/access/territory.ts`)
Tree: `Group – All Brands` (level 0) → `<BRAND>` (level 1, manager = brand manager) → `<BRAND> – <Region>` (level 2).
`resolveTerritory(db, brandId, regionId)` is called by scopedDb on every create/move.
`ensureBrandTerritories(db, brandId)` – call when a brand is created; `ensureRegionTerritories(db, regionId)` – call
when a region is added. Both are idempotent.

## 5. Auth & request flow
* `src/middleware.ts` (edge) – verifies the session JWT with `getToken` (never re-issues the cookie, so sign-out cannot be undone by an in-flight prefetch); redirects to `/login` or returns 401 JSON for `/api/*`.
* JWT payload = `{ sub: userId }` (+ iat/exp/jti). Everything else is loaded server-side per request.
* `requireContext()` (pages/actions) / `requireApiContext()` (route handlers) in `src/server/request.ts`.
* Login, failed login and logout are audited. SSO (Entra ID) only signs in existing, active users matched by email.
* UI filters (brand switcher, region) are cookies sanitized against the context and **ANDed** with the scope –
  they narrow, never widen.

## 6. Audit
`audit({ ctx, action, entity, entityId, brandId, before, after })` (`src/server/db/audit.ts`). scopedDb audits
brand-owned writes automatically; call `audit()` yourself for EXPORT, admin changes to shared/admin tables, approvals,
and anything security-relevant. Secrets (`passwordHash`, `password`, `token`, `secret`) are redacted.

## 7. How to add a module – checklist
1. **Schema**: add the model to `prisma/schema.prisma`. If brand-owned, include the full mixin:
   `brandId, regionId, territoryId?, ownerId, createdById?, updatedById?, createdAt, updatedAt, deletedAt?` with
   relations, plus `@@index([brandId, regionId])`, `@@index([ownerId])`. Add back-relations on Brand/Region/Territory/User.
2. **Migration**: `pnpm db:new-migration <module>` (generates against a throw-away database) or `pnpm db:migrate --name <module>`; then append to that migration
   `SELECT app_enable_brand_rls('"<Model>"');` (and copy the line into a new `prisma/rls/NNN_<module>.sql` only if you
   add new functions/policies). If you add columns to `User`, `GRANT SELECT (<cols>) ON "User" TO stallion_rls`.
3. **Access**: the module key is already in `src/server/access/modules.ts` (add one if not). Give it permissions in
   the profiles (seed + admin UI) – never encode a brand in a profile.
4. **Module folder** `src/server/modules/<module>/`:
   * `schema.ts` – zod input schemas;
   * `queries.ts` – reads via `scopedDb(ctx)`, `assertCan(ctx, module, "read")`, `fieldMask` where relevant, return
     serializable rows; throw `NotFoundError` for missing **and** out-of-scope records;
   * `service.ts` – writes: zod → `assertCan(ctx, module, action, record)` → `scopedDb` write;
   * `actions.ts` – `"use server"` wrappers: `safeAction(() => service(await requireContext(), …))` + `revalidatePath`.
   Use `src/server/modules/deals/*` as the reference.
5. **Child records inherit brand/region** from the parent (Lead → Deal → Quote → SO → Invoice; Activities from parent).
   Set `brandId/regionId` from the parent in the service; never from user input for Sales Execs.
6. **UI**: use the page templates in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (`ModuleListFrame`, `Kanban`, `RecordHeader`, `FormSection`); `BrandBadge` on every row and record header; forms with
   `RecordForm` honoring `fieldAccess`. Wire the module into `src/app/(crm)/[module]/` or a dedicated route.
7. **API**: `src/app/api/v1/<module>/route.ts` with `apiHandler` + `requireApiContext`.
8. **Search**: add a searcher to `src/server/modules/search/queries.ts` (through scopedDb).
9. **Tests** (required):
   * integration: list/get/search/related-list/API for the new model return only in-scope rows for the §6 roles
     (copy `tests/integration/scoped-db.test.ts`); create/move outside territory → `ForbiddenError`;
   * RLS coverage passes automatically once step 2 is done (`tests/integration/rls-coverage.test.ts`);
   * an E2E isolation case in `tests/e2e/`.
10. **Docs**: update `BUSINESS_CONTEXT.md` first if a rule changes, then this file.

## 8. Administration (prompt 01)
`src/server/modules/admin` – every service starts with `assertAdmin(ctx)` (`admin.edit` permission; others get
**404**), writes through `scopedDb` and calls `audit()` explicitly (admin tables are not brand-owned). Two
narrow system queries support it: `moveTerritoryRecords` (includes soft-deleted rows) and `queryAuditLog` (the RLS role
cannot read `AuditLog`). Role → territory rules live in `src/server/access/quick-assign.ts` (pure; used by the UI
helper and the CSV import). The access context is rebuilt on every request, so membership / profile changes apply on
the next request. User guide: [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## 9. Leads (prompt 02) – patterns reused by later modules
- **System context** (`ctx.system = true`, see `intakeContext` in `src/server/modules/leads/intake.ts`): for work without a
  signed-in user (public web-to-lead). It has memberships only for the one brand in the URL, so it cannot write elsewhere;
  createdBy/updatedBy and the audit user are null.
- **Public endpoints** live under `/api/public/*` (no session; listed in `PUBLIC_PATHS`) and must bring their own abuse
  controls (rate limit `src/server/rate-limit.ts`, honeypot, captcha).
- **Duplicate checks across brands** may only learn *that* a match exists (`countHiddenLeadMatches` returns a count).
- **Timelines** read the audit trail via `auditTrail()` only after the record passed a visibility check.
- **Minimal shared models** added here and extended later: `Account`, `Contact` (prompt 03), `Product` (prompt 05); Deal
  gained `accountId`, `contactId`, `modelId`.

## 10. Shared customers (prompt 03)
Accounts and Contacts are **not brand-owned**: one record per customer, readable by every CRM user, with field
visibility decided per viewer by **tiers** (`src/server/access/customer-tier.ts`):

| Tier | Fields | Who |
|---|---|---|
| BASIC | name, type, city, industry, masked phone | every CRM user |
| CONTACT | + phone, email, address, DOB, notes | the viewer can access at least one brand-owned record of the customer, or owns the customer record |
| SENSITIVE | + credit limit, KYC status, RC number | scope ALL, or the Brand Manager of a brand linked to the customer |

- The tier is computed in `src/server/modules/customers/queries.ts` (batched) and applied with `maskByTier` in the one
  place rows are built – so UI, API, search and export always return the same masking. Profile field permissions
  (`fieldMask`) are applied on top and can only restrict further.
- "Can access a record" is evaluated through `scopedDb` (so a deal of the customer in a region the user cannot see does
  not count). This is stricter than "shares a brand".
- Writes follow the tier: `updateAccount` / `updateContact` reject fields above the caller's tier, and forms do not
  render inputs for them.
- **Related lists** on customer pages query brand-owned models through `scopedDb` and show no totals – no count or
  hint of other brands' records. The "brands this customer buys" chips are derived the same way.
- **`CustomerBrandLink`** is maintained by the DB trigger `app_link_customer()`; users cannot write it. A new
  brand-owned model with an `accountId` column must run `SELECT app_track_customer_links('"Model"');` in its migration
  (a test enforces this) and is then picked up automatically by tiers, chips and merges.
- **Merge** (`mergeAccounts` / `mergeContacts`, scope ALL + mass-update permission) re-points children of every brand,
  including soft-deleted ones, via `repointCustomerChildren`, soft-deletes the duplicate with `mergedIntoId` and audits.
- **Consent** is per brand (`ContactBrandConsent`); users set it only for their own brands.
- Filtering customer lists is limited to BASIC-tier fields – filtering on a hidden field would leak it.

## 11. Deals, pipelines & Blueprint (prompt 04)
- **Pipelines are per brand** (`Pipeline`, `PipelineStage`). A DB trigger creates the default pipeline (8 stages,
  BUSINESS_CONTEXT §9) with every brand. `Deal.pipelineId` / `stageId` are always set: the trigger `app_deal_pipeline()`
  fills the brand's default pipeline and first stage, and rejects a pipeline of another brand or a stage of another
  pipeline. Never filter deals by a hard-coded stage name – use `stage.type` (`OPEN | WON | LOST`) or `stage.key`.
- **Blueprint** (`src/server/modules/deals/blueprint.ts`, pure): a move is allowed to the previous / next stage or a
  lost stage (or the stage's configured `allowedTransitions`); managers of the deal's brand-region (`isManagerOf`) may
  jump. To enter a stage every key in `requiredFields` must be satisfied – a filled deal field or a named check
  (`quote`; enforced once the Quote model exists). `moveDealStage` is the only way to change a stage; the UI dialog asks
  for exactly the missing fields.
- **Stage history** (`DealStageHistory`) is written by a trigger on every stage change, whatever the code path; its RLS
  policy shows a row only when the deal is visible.
- **Field rules**: brand cannot be changed by editing (Brand Change approval, prompt 08); region only by managers;
  owner must work in the deal's brand-region (scopedDb); VIN / chassis number is unique per brand; the model must
  belong to the deal's brand.
- **Notes and attachments** (`src/server/modules/notes`) are brand-owned models that copy brand and region from their
  parent, so they are isolated like the parent. Files live in object storage (`src/server/storage`: local disk by
  default, S3-compatible when `S3_*` is configured – that driver is not covered by automated tests) and are only served
  through `/api/v1/attachments/[id]`, which looks the row up with the scoped client first.
- **Saved views** are generic (`src/server/modules/views`); list filters can target a relation column
  (`FieldDef.relation` / `column`).
- Spec names vs. columns: `expectedCloseDate` → `closeDate`, `productId` → `modelId`; the originating lead is
  `Deal.convertedFromLead` (no separate `leadId`).

## 12. Catalogue: brand-tagged master data (prompt 05)
Products, price books and stock references are **brand-tagged**: they carry a `brandId` but no region or owner.
- **Read**: users of the brand (any territory membership in it) and scope ALL. `scopedDb` injects
  `brandTagWhere(ctx)` into reads and bulk writes of the models in `BRAND_TAGGED_MODELS`
  (`src/server/access/brand-tag.ts`); RLS policy `brand_tag` (`app_enable_brand_tag_rls('"Table"')`) enforces it in
  Postgres. A new brand-tagged model needs both: add it to the set and enable the policy in its migration.
  `PriceBookEntry` follows its price book.
- **Write**: `canManageBrandData(ctx, module, action, brandId)` – profile permission plus scope ALL (administrator) or a
  brand-level manager membership (the Brand Manager of that brand).
- **Lookup-filter enforcement**: `assertSameBrand(record.brandId, ref.brandId)` – a record of brand X may only
  reference products, price books or stock of brand X. Used by leads, deals, price book entries and reservations; quote
  and order lines (prompt 06) must use it too. A reference the user cannot see fails the same way. DB triggers
  (`app_same_brand_product`) back it up for price book entries and stock.
- **Prices** (`catalogue/pricing.ts`, pure): `getPrice(ctx, productId, date, priceBookId?)` → entry of the given valid
  book, else the brand's default active book for the date, else the list price. Only one default active book per brand
  may be valid at a time (overlaps are rejected on save).
- **VIN reservation** (`reserveVin` / `releaseVin`): claims a `VehicleStockRef` atomically for a deal; Closed Lost
  releases it (and clears the VIN from the deal), Closed Won marks it sold. This table is a lightweight reference and is
  replaced by the inventory module (prompt 16).

## 13. Quotes, Sales Orders & Invoices (prompt 06)
One implementation serves the three documents (`src/server/modules/documents`, config in `config.ts`; UI in
`src/app/(crm)/_documents`). All three are brand-owned; lines (`DocumentLine`) and `Payment` follow their document
through RLS.
- **Inherited brand and region**: a document copies them from its deal; the trigger `app_document_defaults()` rejects
  any difference, so they cannot be changed on the document.
- **Numbering** `{docPrefix}-{QT|SO|INV}-{YYYY}-{00001}`: assigned by the same trigger from `DocumentCounter`
  (row-locked upsert) inside the INSERT's transaction – unique, sequential and gap-free per brand / type / year, also
  under concurrency. Numbers never change. User sessions cannot touch the counter.
- **Totals** are computed only on the server (`totals.ts`, pure): line discount → header discount → VAT per line from
  the product's tax rate. The client preview uses the same function but nothing it sends is trusted.
- **Products on lines** must belong to the document's brand: `assertSameBrand` in `saveDocument` plus the trigger
  `app_line_same_brand()`.
- **Discount approval**: `discountApproval()` – a line above the price book's `maxDiscountPct`, or any discount above
  the brand's `discountApprovalPct` (default 3 %), needs approval by the Brand Manager; above `discountEscalationPct`
  (default 7 %) by the Head of Sales. `submitQuote` creates an `ApprovalRequest` (brand-owned; owner = requester) and
  sets Pending Approval; sending / accepting is blocked until `decideApproval`. Prompt 08 generalises this model.
- **Lifecycle**: Quote Draft → (Pending Approval) → Approved → Sent → Accepted / Rejected / Expired (one accepted quote
  per deal, partial unique index). Accepted quote → Sales Order (Draft → Confirmed → Allocated → Delivered / Cancelled)
  → Invoice (Draft → Issued → Part-paid → Paid / Void). *Allocated* needs a vehicle reserved for the deal; *Delivered*
  writes VIN and delivery date to the deal and advances its Blueprint stage (`advanceDealToStage`). The Blueprint
  check `quote` (a quote exists) is now enforced when a deal enters Quotation.
- **ERP hand-off**: Sales Order *Confirmed* and Invoice *Issued* store a `document.confirmed` event with the brand's
  `erpCompanyCode` in the `DomainEvent` outbox (`src/server/events.ts`); prompt 13 delivers it.
- **PDF** (`pdf.ts`, pdf-lib): one template filled per brand – logo, legal entity, address, bank details, terms.
  `documentPdfModel` loads through the scoped client, so a hidden document is a 404 before anything is rendered.
  Email with the PDF attached arrives with prompt 10.

## 14. Activities, test drives & calendar (prompt 07)

Module `src/server/modules/activities` (+ `notifications`), UI under `src/app/(crm)/activities` and
`src/components/crm/ActivityPanel.tsx`.

- **Brand inheritance.** `Activity` is brand-owned. `createActivity` loads the parent (Lead, Deal, later Case)
  through `scopedDb` – a hidden parent is a 404 – and copies its brand and region. A shared **Account** has no
  brand, so the caller must pass a brand + region they may write to. `TestDrive` (1:1 subtype) carries the
  brand id and has its own RLS policy derived from the activity. The same visibility rule therefore covers the
  list, calendar, record panel, global search, API and raw SQL.
- **Participants and @mentions** are limited to users who can see the record (management, or a territory of the
  brand that covers the region). Anyone else is rejected with 403 – the note / activity is not created.
- **Test-drive booking.** The DB trigger `app_test_drive_no_overlap` is the authority: two non-cancelled test
  drives of the same brand + VIN may not overlap (advisory lock per vehicle, so concurrent bookings cannot both
  win). The service turns the error into a 400 and removes the half-created activity. Cancelled / no-show
  bookings free the slot. The demo model must belong to the record's brand.
- **Completing a test drive** on a deal calls `advanceDealToStage(…, "TEST_DRIVE", { testDriveDate, modelId })`:
  the deal moves from Enquiry to Test Drive when the Blueprint requirements are met; stage history is written by
  the existing trigger. No-show / cancelled never move the deal. A follow-up date creates a follow-up task.
- **Sensitive field.** The driving licence number is returned in full only to the owner, a manager of the
  brand-region and management; everyone else gets `****NN`.
- **Recurrence.** `FREQ=DAILY|WEEKLY|MONTHLY` (+ `INTERVAL`, `UNTIL`); the next occurrence is created when the
  current one is completed (`recurrence.ts`, pure and unit-tested).
- **Calendar.** Server-rendered month / week / day views in Africa/Lagos time (`Calendar.tsx`, no client JS).
  Managers overlay only users in territories they manage (`teamMembers`); ids outside that set are dropped, and
  the events still pass through `scopedDb`.
- **Notifications.** `Notification` rows are readable by the recipient only (RLS). They are created for
  assignments, mentions and reminders and shown in the bell of the top bar. Reminders are produced by
  `POST /api/public/cron/reminders` (`Authorization: Bearer $CRON_SECRET`, 404 when the secret is unset,
  idempotent through `reminderSentAt`). The rail shows the user's overdue count on Activities.
- **Lead conversion** moves the lead's activities to the new deal.
- **API.** `GET/POST /api/v1/activities`, `GET/PATCH /api/v1/activities/:id`, `POST /api/v1/activities/:id/complete`.
- **Not in this prompt.** Confirmation SMS / WhatsApp / email for bookings and reminder emails are sent by the
  messaging service of prompt 10; the indemnity file upload uses the generic attachments of the parent record;
  drag-and-drop rescheduling in the calendar is not implemented (reschedule on the activity page).

## 15. Approvals & workflow automation (prompt 08)

### Approval engine (`src/server/db/approval-engine.ts`, `src/server/modules/approvals`)

- **Model.** `ApprovalProcess` (key, module, optional brand, criteria) → `ApprovalStep` (order, slot, approver type,
  condition, auto-approve hours). `ApprovalRequest` (brand-owned: the record's brand, owner = requester, payload,
  comment trail) → `ApprovalTask` (one per approver). Steps with the same **order** run in parallel; steps that
  share a **slot** are alternatives (any one approver decides). A step whose approver is the requester is
  approved on the spot.
- **Why it lives in the db layer.** Approvals deliberately cross what one user may write: the manager of the NEW
  brand decides a brand change on a record they cannot see, and applying it moves a record between brands. The
  engine authorises the caller (can see the record / holds a task / may override) and then works with the system
  client in ONE transaction; nothing else in the app does.
- **Isolation.** Tasks are readable by their approver and by users who can see the record's brand-region (RLS
  policy `approval_task_read`); they can only be written by the engine. An SNMNL manager never sees an HMNL
  request – not in the inbox, not through SQL, and deciding it is a 404. The inbox shows a link to the record
  only when the viewer can open it.
- **Seeded processes** (`app_seed_automation()` in the migration; also called by the dev seed):
  1. `DISCOUNT` (quotes): above the brand's threshold A (`Brand.discountApprovalPct`, default 3 %) or the price
     book maximum → Brand Manager; above threshold B (`discountEscalationPct`, default 7 %) → then Head of Sales.
     Thresholds are edited per brand in Setup → Brands.
  2. `BRAND_CHANGE` (leads, deals): Brand Managers of the OLD and the NEW brand in parallel. On approval the
     record moves atomically: territory recalculated, deal pipeline follows the brand (stage kept by key),
     quotes / activities / notes / attachments move with it, one audit entry with before / after. Brand-specific
     links cannot follow: the model and reserved vehicle are cleared, quotes return to Draft without product
     links (their number keeps the old prefix). A deal with sales orders or invoices cannot change brand.
  3. `OWNER_TRANSFER` (leads, deals) to another region: the RSM of the old / new region **or** the Brand Manager.
- **Lock.** While a request is pending the record is read-only: trigger `app_lock_pending_approval` on Lead, Deal
  and Quote rejects updates from the RLS role unless `app.admin = 1` (administrators). The API answers 409
  `LOCKED`; the UI hides the edit actions and shows the banner with approve / reject / recall.
- **Overrides and timing.** Administrators, and Management with an approve permission, may decide in place of the
  assigned approvers. A step can auto-approve after N hours (Setup → Approval processes); the scheduler applies it.
- **Notifications.** New approvers and the requester get an in-app notification; the rail shows the number of
  pending decisions. Email delivery joins with prompt 10.

### Workflow rules (`src/server/modules/workflow`, `src/server/db/workflow-store.ts`, `src/server/db/jobs.ts`)

- **Rule** = module (leads, deals, quotes, sales orders) + trigger + optional brand + criteria + actions.
  Triggers: on create, on edit, field change (from the `scopedDb` write hook), date-based and scheduled (from the
  scheduler tick). Criteria are AND / OR trees over the module schema (`modules.ts`); the same tree is evaluated
  in memory and translated to a Prisma `where` for scheduled scans (`src/server/automation/criteria.ts`).
- **Actions:** field update (whitelisted fields), create task / call, notification, email (outbox event
  `email.requested`, delivered by prompt 10), webhook (https only, public addresses only, HMAC signature with
  `WEBHOOK_SECRET`, ids only in the payload), assign owner, call function.
- **Brand boundary.** Actions run with a system context bound to the record's brand (`automationContext`): every
  read and write still goes through `scopedDb` + RLS with a single brand-level membership. A rule scoped to HMNL
  only matches HMNL records, and notifications only reach users who can see the record. Writes made by rules do
  not trigger rules again (no cascades).
- **Job queue.** Table `Job` (system-only): `FOR UPDATE SKIP LOCKED` claiming, exponential back-off, `DEAD` after
  5 attempts, idempotency keys (`wf:<rule>:<record>:<once | updatedAt | day>`) so a scheduled rule fires once per
  record / staleness episode, and per-action progress so a retry never repeats a completed action. Event jobs
  run right after the request (`JOBS_INLINE`, on by default); `POST /api/public/cron/tick` (Bearer
  `CRON_SECRET`) is the heartbeat: scheduled rules, due jobs, activity reminders, approval auto-approvals. pg-boss
  was not needed at this volume – the table gives the same guarantees and is the run log (Setup → Automation run log).
- **Seeded rules:** quote / sales order inherit brand and region from the deal (safety net on top of the DB
  trigger), deal not updated for 7 days → task for the owner + notification to the Brand Manager, hot lead not
  contacted in 2 hours → escalation to the Brand Manager, deal Closed Won → thank-you task + follow-up call after
  3 days.
- **Limits.** Bulk writes (`updateMany`, imports) do not fire event rules; the builder edits one AND group plus one
  OR group (deeper trees are accepted by the engine and API); approval processes are seeded and tunable (active,
  auto-approve) – a full process designer is not part of this prompt.

## 16. Reports, dashboards, forecasts & targets (prompt 09)

**Rule:** every analytics query runs through `scopedDb(ctx)` – in practice `scopedDb(ctx).$queryRaw`, i.e. inside the
viewer's RLS transaction (role `stallion_rls` + `app.*` settings). Postgres filters every table a query touches
(base table, joins, sub-selects, the `DealFact` view) by the **viewer's** access, whoever built or shared the report.

### Report engine (`src/server/modules/reports`)

- `catalog.ts` – the modules (deals, leads, quotes, activities), their joins (deal ↔ account ↔ product, activity
  counts) and fields, each with a fixed SQL fragment. These fragments are the only identifiers that reach a
  query; a definition selects catalog **keys** (validated by `definition.ts`) and all values are bound parameters.
  Contact details (phone, email, licence numbers) are not in the catalog.
- `engine.ts` – one SQL statement per run: `GROUP BY` up to three levels (dates by day / week / month / quarter /
  year in Africa/Lagos time), summaries (count, sum, avg, min, max), filters, date presets, or a paged record
  list. Three standard reports that span several tables (funnel, lead source ROI, exec performance) are fixed
  queries in the same file. Timestamps are compared as UTC literals so results do not depend on the session
  time zone.
- `service.ts` – saved reports. Folder = who can **open** the definition (RLS on `Report`): Private (owner only –
  management included), Brand (users of that brand), Group (everyone); standard reports have no owner and are
  read-only ("Save a copy"). Opening a shared report runs it with the viewer's context.
- **Export** (`GET /api/v1/reports/:id/export?format=csv|xlsx`): requires `reports.export` (the Sales Exec profile
  has none → 403, no buttons), exports exactly the rows the viewer sees, and writes an `EXPORT` audit entry with
  the row count. XLSX is produced by `src/lib/xlsx.ts` (no dependency; cells are inline strings / numbers, never
  formulas); CSV neutralises formula injection.
- Standard reports are seeded by `app_seed_reports()` (migration; also called by the dev seed): pipeline by stage
  and brand, won by brand / region / month, conversion funnel, lead source ROI, exec performance, lost deals by
  reason and competitor, stale deals, discount given vs approved, quote aging.

### Dashboards (`src/server/modules/dashboards`)

Four definitions in code (Group, Brand, Region, My Sales) made of KPI tiles, charts, tables, a target meter and
a leaderboard. A viewer lands on the dashboard of their role but may open any of them – the same definition
shows different numbers per viewer because every widget is computed with their context ("My" widgets add an
owner filter). Charts are dependency-free server-rendered SVG (`src/components/charts.tsx`) with text alternatives.

### Forecasts & targets (`src/server/modules/forecasts`)

- `Target` (month / quarter × brand × optional region × optional user; units and revenue). Set by management or
  the brand's own Brand Manager (`forecasts.edit` + brand-level manager membership); RLS allows writes only to
  management and brand-level members and reads to the brand's managers, the brand-region's members (region and
  user targets) and the user concerned. Colleagues' personal targets are additionally hidden from non-managers
  in the service.
- **Forecast** for deals expected to close in the period = won + committed (open deals at Booking or later) +
  weighted rest (amount × stage probability) + managers' adjustments, rolled up User → Brand-Region → Brand →
  Group. A level without its own target shows the sum of the targets below it. `ForecastNote` holds the commit /
  adjustment notes of managers.

### Performance

`DealFact` is a view `WITH (security_invoker = true)` – RLS of `Deal` applies to whoever queries it. With 100,000
deals (`tests/integration/analytics-performance.test.ts`) dashboards load in well under the 2 s budget
(roughly 50–450 ms on a developer machine), so no materialized views were added: they cannot carry RLS and
would need a per-viewer filter layer on top. If volumes grow, add them behind security-invoker views and
refresh them from the job queue of prompt 08.

## 17. Communications: email, SMS, WhatsApp & campaigns (prompt 10)

Module `src/server/modules/messaging` (`providers.ts`, `merge.ts`, `service.ts`, `campaigns.ts`), system helpers in
`src/server/db/messaging-system.ts`, webhooks under `src/app/api/public/webhooks`.

- **Adapters behind one interface** (`providers.ts`): email via SMTP or Microsoft 365 Graph, SMS via Termii or
  Africa's Talking, WhatsApp via the Business Cloud API. The adapter is chosen per channel by environment
  variables; credentials live in the environment / secret store only. Without configuration every channel uses
  the **sandbox** adapter (keeps messages in memory – development, tests, demos).
- **Sender identity per brand** (Setup → Brands): from-name / from-address, SMS sender ID, the number that
  receives SMS replies, the WhatsApp number and its phone-number id. `senderIdentity()` derives the sender from
  the record's brand – callers cannot pass one – and refuses to send when the brand has none configured. A
  message about an HMNL record is always sent as HMNL.
- **Logging.** `deliver()` writes an Activity (`EMAIL_LOG` / `SMS_LOG` / `WHATSAPP_LOG`) and a `Message` row
  BEFORE calling the provider (a failure stays on the record as FAILED). Both are brand-owned with the brand
  and region of the record, so message content on an SNMNL record is invisible to HMNL users (scopedDb + RLS).
- **Inbound** (`receiveInbound`): the brand is the owner of the number that RECEIVED the message. The sender's
  phone is matched to that brand's open lead, else to an open deal of a contact with that phone; unknown
  senders become a lead of that brand (assigned by its assignment rules, default region Lagos). The same
  customer writing to two brands' numbers ends up in two separate, mutually invisible conversations.
  "STOP" opts the sender out of that brand's marketing. Provider retries are de-duplicated by message id.
- **WhatsApp rules.** Free text only within 24 hours of the customer's last message; otherwise a template whose
  registration status is APPROVED (kept on the template).
- **Templates.** Group templates (brand NULL – management / administrators) and brand templates (the brand's
  manager). Merge fields are plain-text substitutions of own properties (`{{contact.firstName}}`,
  `{{deal.model}}`, `{{brand.name}}`, `{{owner.name}}`, `{{unsubscribeUrl}}`); email HTML is produced by escaping
  the final text. A campaign can only use a template of its brand or a group template (service + DB trigger).
- **Campaigns** belong to one brand (brand-tagged + RLS). The audience is built with the creator's access context
  from that brand's leads or customers (contacts on the brand's deals), optionally narrowed by a saved report,
  and split by consent **for that brand** (`ContactBrandConsent` / the lead's own consent): PENDING, or
  SUPPRESSED with the reason. An HMNL manager therefore cannot target SNMNL-only customers, and an opt-out of
  one brand never affects another.
- **Sending** needs the `massEmail` permission (Brand Manager, Management, Administrator). `launchCampaign`
  queues batches of 25 on the job queue, spread at `MESSAGING_RATE_PER_MINUTE`; the worker re-checks consent
  right before each message, adds the brand's opt-out (unsubscribe link / "Reply STOP") and logs the message on
  the lead / deal. Delivery webhooks move message and member status forward only (sent → delivered → opened →
  clicked); replies mark the member Responded.
- **Unsubscribe** (`/api/public/unsubscribe/<token>`): GET shows a confirmation page, POST opts out of the
  campaign's brand only. Unknown tokens get a neutral page.
- **Webhooks** are disabled (404) until their secret is configured: `MESSAGING_WEBHOOK_SECRET` (token in the
  query or Authorization header) for SMS / email / generic gateways, and Meta's body signature
  (`WHATSAPP_APP_SECRET`) for WhatsApp.
- **ROI.** Leads carry `campaignId` (web-to-lead `utm_campaign=<campaign code>`, replies of campaign members);
  conversion copies it to the deal; a DB trigger keeps attribution inside the brand. ROI = (won revenue − budget)
  ÷ budget.
- **Internal email.** Workflow "send email" actions and – with `NOTIFICATION_EMAILS=1` – reminders, mentions,
  assignments and approvals are emailed to CRM users through the job queue (`email.users`).
- **Not included.** Open / click tracking pixels (statuses come from provider webhooks); automatic test-drive
  confirmation (send it from the record with a template); registering WhatsApp templates with Meta from inside
  the CRM (the approved name and status are recorded on the template); inbound email.

## 18. Cases: customer care & complaints (prompt 11)

Module `src/server/modules/cases` (`schema`, `queries`, `service`, `admin`, `business-hours`), system helpers in
`src/server/db/cases-system.ts`, UI under `src/app/(crm)/cases`.

- **Brand-owned.** `Case` carries the brand-owned mixin: scopedDb + RLS isolate it like deals – an HMNL agent
  cannot see, find, change or create SNMNL cases (404 / 403), and its notes, attachments, activities and
  messages inherit the case's brand. A case on a deal takes brand, region, account and contact from the deal;
  a DB trigger rejects a deal of another brand.
- **Numbering.** `{docPrefix}-CS-{YYYY}-{00001}` per brand and year from the same gap-free `DocumentCounter` as
  quotes (trigger `app_case_defaults`); numbers are immutable.
- **Queues.** My Cases, Unassigned – My Brand, Breaching SLA, All Open, All. New cases created by an agent are
  theirs; cases from the public form or an inbound message are assigned by the assignment engine of prompt 02
  (`assignRecord(ctx, "cases", …)`: module rules, then round-robin in the brand-region territory). When only a
  manager is available the case is parked with them and flagged **unassigned** until someone takes it.
- **SLA.** `SlaPolicy` per brand and priority (first response / resolution hours, escalation role; defaults are
  created for every brand by trigger, edited by the brand's manager). Due times are computed in **business
  hours** (`business-hours.ts`: working days and hours in Africa/Lagos, public holidays; calendar edited by
  administrators, fixed-date Nigerian holidays seeded, movable ones added by hand). Leaving "New" is the first
  response; changing the priority recalculates from the creation time. There is no clock stop while "Waiting on
  customer".
- **Escalation through the workflow engine.** Cases are a workflow module; the seeded scheduled rule "Case
  breaching its SLA" (`isOpen` and `slaBreached`) calls the function `escalateCase`, which runs with the
  system context bound to the case's brand, marks the case Escalated and notifies the role of the SLA policy –
  filtered to users who can see the case, so it is always the Brand Manager of the case's own brand. It fires
  once per case.
- **Intake.** `POST /api/public/cases/<BRAND>` (web form or email-to-case gateway, honeypot + rate limit; the
  brand comes from the URL, a known customer is linked by phone / email), "Create case from this message / call"
  on an inbound activity, and "+ New" on deal and account pages.
- **Satisfaction survey.** Closing a case sends a survey link as the case's brand (email, else SMS; template
  "Case satisfaction survey" when one exists). `/api/public/csat/<token>` shows a 1–5 form and stores the first
  answer only.
- **Solutions.** Knowledge articles: group articles (brand NULL) for everyone, brand articles only for that
  brand's users (RLS); drafts are visible to those who may edit them (brand manager / management). Matching
  articles are suggested on the case by type and subject.
- **Reports.** The report builder has a Cases module; standard reports: cases by brand and type, SLA compliance,
  customer satisfaction.

## 19. Import, export & customization (prompt 12)

Modules `src/server/modules/{imports,exports,customization}`, system helpers `src/server/db/{backup,customization-system}.ts`,
UI under `/imports`, `/exports` and `/admin/customization`. Runbook: [MIGRATION_FROM_ZOHO.md](MIGRATION_FROM_ZOHO.md).

- **Import wizard.** Upload (CSV / XLSX, parsed by `src/lib/xlsx-read.ts`, max 5 MB / 5,000 rows) → column and
  value mapping (Zoho column names and stage names recognised, legacy company codes through brand aliases,
  saved mapping templates) → **dry run** (`imports/plan.ts`, a pure function: per row the resolved brand, the
  action and its errors) → commit as job `import.run` → result and **undo** (`ImportRecord` remembers what an
  import created). The plan is rebuilt at commit time, never trusted from the browser.
- **Brand isolation.** Rows are written through `scopedDb` with the importer's context, so RLS applies. Brand
  Managers may import into their own brands only: a row resolving to another brand is an error – never
  re-mapped. `ImportJob`s are visible to their owner and administrators.
- **Exports.** `GET /api/v1/export/<module>?format=csv|xlsx` reuses the list queries, so scoping, masking and
  filters are those of the list view; profile field permissions are applied again per column. Needs the
  module's `export` permission; every export is audited with its filters and row count. Above
  `EXPORT_SYNC_LIMIT` rows the export becomes job `export.run`, built with the requester's access *at run
  time*; the file is stored for 24 hours, downloadable by its owner only and purged by the scheduler tick.
- **Full backup.** `POST /api/v1/admin/backup` (administrators; 404 otherwise): one CSV per table in a zip,
  encrypted with AES-256-GCM (scrypt key from the passphrase, `src/lib/backup-crypto.ts`). The passphrase
  travels in the POST body and is never stored; secrets such as password hashes are excluded.
- **Custom fields.** Definitions in `CustomField` (per module, optionally per brand), values in the record's
  `customFields` JSONB. `customization/engine.ts` validates values against the definitions that apply to the
  record's brand (values of other brands' fields are dropped), computes formula fields with the safe expression
  parser `src/server/automation/formula.ts` (no `eval`) and feeds list filters (`jsonPath`). Definitions of
  a brand are hidden from other brands by RLS. An administrator can switch on an expression index per field.
  Field-level security uses the key `cf_<apiName>` in the profile's field permissions.
- **Layouts.** `Layout` per module with optional brand variants: sections of the custom-field block,
  additionally required fields and rules (SHOW / HIDE / REQUIRE fields WHEN a field matches). Rules are
  evaluated in the browser for the form and **again on the server** when saving. Standard fields keep their
  position; forms for custom fields exist on leads and deals, other modules take them through the API.

## 20. Public API, webhooks & integrations (prompt 13)

Guide for integrators: [API.md](API.md). Code: `src/server/modules/api` (tokens, paging, soft delete, OpenAPI),
`src/server/integrations` (events, webhooks, erp, payments, oem, calendar), system store `src/server/db/api-store.ts`.

- **One access model.** `requireApiContext()` resolves `Authorization: Bearer scrm_…` to the token's user
  and builds the ordinary `AccessContext` – from there the API is the same code path as the UI (`scopedDb`,
  RLS, `can()`, field masks). Integration principals are users flagged `isIntegration` (no password, cannot
  sign in). `restrictToBrands` narrows a context to the token's brands and can never widen it. The edge
  middleware lets bearer requests through for `/api/v1/*` only; pages always need a session.
- **System tables.** `ApiToken`, `OAuthClient`, `IdempotencyKey`, `WebhookSubscription`, `WebhookDelivery`,
  `ExternalRef`, `PaymentLink` are revoked from the RLS role; services check owner / administrator and call
  the narrow functions of `api-store.ts`. Token and client secrets are stored as SHA-256 hashes.
- **Field masks at the boundary.** API responses and webhook payloads of deals, cases, activities and documents
  pass through `fieldMask` (leads and customers are masked by their queries).
- **Events.** `scopedDb` reports single creates / updates of Lead, Deal, Quote, SalesOrder, Invoice and Case
  to `integrations/events.ts`; `deriveEvents` (pure) names them, `dispatchEvent` writes the outbox
  (`DomainEvent`) and enqueues one `webhook.deliver` job per matching subscription and an idempotent
  `erp.post` job. Quote approval is raised by the approvals service (the approval engine writes with the
  system client). Dispatch never throws into the user's action.
- **Webhook delivery.** The job loads the record with the subscription principal's context; hidden → SKIPPED.
  Body signed with HMAC-SHA256 over `<timestamp>.<body>`; https + public address only (SSRF guard shared with
  workflow webhooks); retries through the job queue's back-off; `WebhookDelivery` is the log.
- **Per-legal-entity integrations.** ERP adapter, base URL, token and payment keys resolve per brand
  (`brandEnv`). `erp.post` reads the document with a context bound to the event's brand and posts it to
  `Brand.erpCompanyCode`; reconciliation checks the company code; payment webhooks are verified with the
  merchant key of the brand owning the reference.
- **Idempotency & limits.** `apiHandler` replays stored responses for `Idempotency-Key` (token-scoped,
  24 h). Rate limits are per token and per process (in-memory) – see API.md for the multi-instance caveat.

## 21. Inventory: vehicles & parts per brand (prompt 16)

User guide: [INVENTORY_GUIDE.md](INVENTORY_GUIDE.md). Code: `src/server/modules/inventory` (pure: `vin`,
`status`, `costing`, `journal`; `config`, `queries`, `service`, `reports`, `pdf`, `routes`), the posting
engine `src/server/db/inventory-posting.ts`, UI under `src/app/(crm)/inventory`, API under
`/api/v1/inventory/*`. It replaces `VehicleStockRef` of prompt 05 (rows migrated to `VehicleUnit`).

- **Brand isolation.** All inventory tables are brand-TAGGED (`brandId`, policy `brand_tag`, `scopedDb`
  filter): another brand's warehouse, unit, vendor, document, movement, balance or journal does not exist for a
  user – lists, ids (404), scanner lookup, reports, API, raw SQL. Triggers refuse cross-brand references even
  for the system client (unit ↔ product / warehouse / deal / order / invoice, document ↔ vendor / warehouse).
- **Three views.** (1) brand; (2) the *sales view* for users without stock-keeping rights – available units and
  the units of their own deals, VIN masked to the last six characters until the unit is theirs; (3) the cost
  tier – without `inventoryFinance.read` cost fields are absent from every result, and costs in requests are
  replaced by the purchase order's price (`trustedCosts`).
- **One document table.** `InventoryDocument` + `InventoryDocumentLine` with a configuration per type
  (`config.ts`: PO, shipment, goods receipt, bill, landed cost, transfer, inter-brand transfer, adjustment, PDI,
  delivery note, stock count, vendor credit). Numbers are gap-free per brand / type / year from the shared
  `DocumentCounter` (trigger `app_inventory_number`).
- **Posting engine.** A posting changes the ledger, the balances, units with their status history, the journal
  and the document status in ONE transaction with the system client (row lock on the document; period lock
  check). `StockMovement` is append-only for every role (trigger), `StockBalance` is maintained in the same
  transaction, `JournalEntry` is immutable and must balance (deferred constraint trigger). Services check
  brand + permission first; user sessions have no write grant on ledger, balances, journals or history.
- **Valuation.** Vehicles: specific identification (purchase cost + allocated landed cost). Quantity items:
  weighted average or FIFO per brand. `valuation as of` is a sum over the append-only ledger.
- **Status machine.** `status.ts` is the only place that knows the transitions; `setStatus` in the posting
  engine enforces it and writes the history. Reservation takes a row lock – one winner; expiry runs in the tick.
- **Sales integration.** `reserveVin` → `reserveUnit`; sales order *allocate* → `allocateUnits` (own brand
  only); invoice *issue* → `issueForInvoice` (SALE_ISSUE + COGS journal, once per unit); *deliver* →
  `deliverUnits` (delivery note). Closed Lost releases, Closed Won removes the reservation expiry.
- **Inter-brand transfer.** The document row belongs to the selling brand (RLS). The buying brand works through
  `incomingInterBrand` / `patchInterBrand` (units and transfer price only) and receives a NEW unit of its own
  at the transfer price; each side posts its own journal.
- **Events & ERP.** `vehicle.received`, `vehicle.status_changed`, `vehicle.reserved`, `vehicle.delivered`,
  `stock.below_reorder` (when an issue brings a part to its reorder level), `journal.posted` → webhooks (payload = the principal's
  view, so cost only for finance principals) and, for journals, the brand's ERP adapter when it supports them.

## 22. Mobile PWA, global search & notifications (prompt 14)

User-facing description: [MOBILE.md](MOBILE.md).

- **PWA.** `src/app/manifest.ts`, icons generated by `scripts/make-icons.mjs`, service worker `public/sw.js`.
  The worker caches only the static offline shell (`/offline`) and `/_next/static` assets, answers failed
  navigations with the shell, and handles web push. It never stores a page or an API response – those are per
  user. `/sw.js`, `/manifest.webmanifest` and `/offline` are public paths (no data).
- **Offline data.** `src/server/modules/offline/service.ts`: `snapshot` (the caller's own open leads, deals,
  activities through the normal list queries and masks) with `scopeHash` (fingerprint of user, profile,
  permissions, field permissions and memberships); `syncOutbox` (create lead / log call / add note, applied
  once per client key through `IdempotencyKey`, with the caller's current access – 403 / 404 → conflict).
  Client: `src/lib/offline/store.ts` (IndexedDB; `needsWipe` is the pure rule) and `sync.ts`;
  `PwaClient` in the shell refreshes and flushes; the sign-in page wipes the store.
- **Mobile shell.** The module rail is hidden below `md`; `MobileNav` (bottom bar + "More" sheet) is built
  from the same permission-filtered module list.
- **Search.** `modules/search/queries.ts` fans out to per-module searchers that all use `scopedDb`;
  migration `mobile_search` adds `pg_trgm` GIN indexes for the searched columns. Visibility is never in the
  index – it is applied by the query, so an index can not leak.
- **Notifications.** `notify()` reads each recipient's preferences (system read: a sender cannot read another
  user's preferences) and fans out to in-app rows, the e-mail job and the `push.send` job. Quiet hours and
  per-type channels are pure functions in `notifications/preferences.ts`. `PushSubscription` has RLS "own rows".
  The tick sends the daily digest (idempotent per user and day) and stale-deal notifications.

## 23. Isolation suite, security hardening & operations (prompt 15)

Details and the ASVS status: [SECURITY.md](SECURITY.md). Go-live: [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).

- **Isolation suite** (`tests/isolation`, vitest project `isolation`, required CI step): a generated fixture
  (`fixture.ts`: 2 brands × 2 regions, 11 personas, rows of every brand-owned model), the model × persona matrix
  against an independent reference rule through the scoped client and raw SQL, the access paths, VT-01 … VT-17, and
  a seeded property-based test. New brand-owned models are detected from the schema.
- **IDOR scan** (`tests/e2e/zz-idor.spec.ts`): discovers every `/api/v1/**/[id]/**` route from the file system.
- **Sign-in protection** (`src/server/auth/protection.ts`, `auth/index.ts`): throttling of failed attempts,
  database lockout (`User.failedLogins`, `lockedUntil`), optional TOTP with an encrypted secret that is omitted
  from every query by default and not granted to the RLS role, SSO-only switch.
- **Field-level security on writes**: `stripUneditable` in the update services of leads, deals and cases;
  `fieldMaskView` on their screens (hidden → null).
- **Headers & CSRF**: `next.config.ts` (CSP and friends), origin check for the cookie-authenticated JSON API in
  `middleware.ts`.
- **Audit log** append-only by trigger (`app_audit_immutable`) in addition to the missing grants.
- **Operations**: `/api/public/health`, `src/server/error-tracking.ts` + `src/instrumentation.ts`
  (Sentry-compatible, error and route only), `scripts/backup.sh`, `scripts/bootstrap.ts` (`pnpm db:bootstrap`),
  access review (`modules/security/service.ts`, Setup → Data Administration).

## 24. Local development
See [README](../README.md). Integration tests use `TEST_DATABASE_URL` when set, otherwise start an embedded
PostgreSQL 16 automatically (no Docker needed, always UTF-8). The seeded database is a **template**: every integration test file
runs against its own `CREATE DATABASE … TEMPLATE` copy, so tests may change organisation data freely. E2E uses `E2E_DATABASE_URL` or an embedded database likewise.
