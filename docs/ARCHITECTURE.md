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

## 14. Local development
See [README](../README.md). Integration tests use `TEST_DATABASE_URL` when set, otherwise start an embedded
PostgreSQL 16 automatically (no Docker needed, always UTF-8). The seeded database is a **template**: every integration test file
runs against its own `CREATE DATABASE … TEMPLATE` copy, so tests may change organisation data freely. E2E uses `E2E_DATABASE_URL` or an embedded database likewise.
