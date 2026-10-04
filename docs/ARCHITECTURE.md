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
2. **Migration**: `pnpm db:migrate --name <module>`; then append to that migration
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
6. **UI**: list page with `DataTable` + `BrandBadge` on every row; record header with `BrandBadge`; forms with
   `RecordForm` honoring `fieldAccess`. Wire the module into `src/app/(crm)/[module]/` or a dedicated route.
7. **API**: `src/app/api/v1/<module>/route.ts` with `apiHandler` + `requireApiContext`.
8. **Search**: add a searcher to `src/server/modules/search/queries.ts` (through scopedDb).
9. **Tests** (required):
   * integration: list/get/search/related-list/API for the new model return only in-scope rows for the §6 roles
     (copy `tests/integration/scoped-db.test.ts`); create/move outside territory → `ForbiddenError`;
   * RLS coverage passes automatically once step 2 is done (`tests/integration/rls-coverage.test.ts`);
   * an E2E isolation case in `tests/e2e/`.
10. **Docs**: update `BUSINESS_CONTEXT.md` first if a rule changes, then this file.

## 8. Local development
See [README](../README.md). Integration tests use `TEST_DATABASE_URL` when set, otherwise start an embedded
PostgreSQL 16 automatically (no Docker needed). E2E uses `E2E_DATABASE_URL` or an embedded database likewise.
