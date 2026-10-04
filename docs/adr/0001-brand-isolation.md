# ADR 0001 – Brand isolation: one database, territory visibility, enforced twice

- Status: accepted
- Date: 2026-10-04

## Context
One dealer group sells up to 10 vehicle brands, each a separate legal entity. Sales users must never read or change
another brand's sales data through the UI, search, reports, exports, related lists or the API, while management and
regional staff see across brands (BUSINESS_CONTEXT §1, §5–§7). Customers are shared across brands.

## Options considered
1. **Database / schema per brand** – strong isolation, but shared customers, cross-brand regional users, consolidated
   management reporting and 10× migrations make it costly.
2. **Application-only filtering** – simple, but a single missed `where` leaks data.
3. **One database; territory-based visibility enforced in the application AND in PostgreSQL RLS.**

## Decision
Option 3.
- Every brand-owned row carries `brandId` + `regionId` (mandatory) + `ownerId`; territory = brand × region.
- The visibility rule is implemented once in `src/server/access/visibility.ts`.
- Application code can only reach the database through `scopedDb(ctx)`, a Prisma extension that injects the rule into
  every query, include and count, validates creates/moves and audits writes. The raw client is lint-banned outside
  `src/server/db`.
- Every scoped query runs as the non-owner role `stallion_rls` with the user's context in transaction-local settings;
  RLS policies implement the same rule in SQL, so a bug in layer 1 still cannot return another brand's rows.
- Records outside scope return 404, never 403.
- Brand is never encoded in a profile: 5 profiles serve all brands; brand access comes from territory memberships.

## Consequences
- + Isolation holds for raw SQL, relation includes and future modules automatically (models are detected from the
  schema; a test fails if a brand-owned table lacks RLS).
- + One login per person; multi-brand reps and regional managers are just more memberships.
- − Each scoped operation is a short transaction (SET LOCAL ROLE + set_config + query): a little latency, and no
  interactive transactions on the scoped client.
- − Migrations must run as a role that can create `stallion_rls` and grant it to itself.
- − Two implementations of the rule (TS + SQL) must stay in sync – covered by integration tests that compare them
  for every seeded user.
