# StallionCRM

Multi-brand automotive sales CRM (a Zoho CRM replacement) for a dealer group with up to 10 vehicle brands.
The core property is **brand isolation**: a user never reads or changes sales data of a brand they are not
entitled to – via UI, search, reports, exports, related lists or the API.

- Business rules: [`docs/BUSINESS_CONTEXT.md`](docs/BUSINESS_CONTEXT.md)
- How it is enforced and how to add a module: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- UI design system and page templates: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- Administering brands, territories, profiles and users: [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md)
- Decision record: [`docs/adr/0001-brand-isolation.md`](docs/adr/0001-brand-isolation.md)
- Security, isolation tests and known limitations: [`docs/SECURITY.md`](docs/SECURITY.md)
- Go-live: [`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md) · migration from Zoho: [`docs/MIGRATION_FROM_ZOHO.md`](docs/MIGRATION_FROM_ZOHO.md)
- API, webhooks and integrations: [`docs/API.md`](docs/API.md) · inventory: [`docs/INVENTORY_GUIDE.md`](docs/INVENTORY_GUIDE.md) · mobile app: [`docs/MOBILE.md`](docs/MOBILE.md)

> **Public repository.** Never commit real employee or customer data. Seed data is fictitious; real users are
> imported at runtime through the admin CSV import. `/private` and `/imports/**/*.csv` are git-ignored.

## Requirements
- Node.js ≥ 20.18 and pnpm 9 (`npm i -g pnpm@9` or `corepack enable`)
- PostgreSQL 16 – via Docker (`docker compose up -d`) **or** the built-in Docker-free option (`pnpm db:local`)

## Setup
```bash
pnpm install
cp .env.example .env            # set AUTH_SECRET (npx auth secret)

# Option A – Docker (Postgres 16 + Mailpit on http://localhost:8025)
docker compose up -d
pnpm db:deploy && pnpm db:seed

# Option B – no Docker: embedded Postgres 16 in ./.local/pg on port 54329 (migrates + seeds on first run)
pnpm db:local                    # keep running; set DATABASE_URL in .env to the URL it prints
                                 # (delete ./.local/pg once if it was created before the UTF-8 fix)

pnpm dev                         # http://localhost:3000
```
The database role in `DATABASE_URL` must be allowed to create a role on first migration (it creates the NOLOGIN
role `stallion_rls` used for Row-Level Security). The default `postgres` user is fine locally.

### Demo logins (fictitious seed – password `Stallion!2026`)
| Email | Role | Sees |
|---|---|---|
| `md@stallioncrm.test` | Managing Director | everything |
| `admin@stallioncrm.test` | CRM Administrator | everything + `/admin` |
| `bm.hmnl@stallioncrm.test` | Brand Manager HMNL | HMNL, all regions |
| `exec.hmnl.1@stallioncrm.test` | Lagos Sales Exec | HMNL – Lagos |
| `exec.multi.1@stallioncrm.test` | Lagos Sales Exec (multi-brand) | HMNL + SNMNL – Lagos |
| `rsm@stallioncrm.test` | Regional Sales Manager | all brands, Abuja / Port Harcourt / Ibadan |
| `exec.abuja@stallioncrm.test` | Regional Sales Exec | all brands, Abuja |

Inventory staff: `stock.hmnl@…` (Stock Controller), `logistics.hmnl@…` (Logistics), `acct.hmnl@…` (Brand Accountant).
See `prisma/seed-data.ts` for all 31 users. **The seed is for development and demos only** – it must never be
run in production (public password).

### First administrator (production)
On an empty, migrated database run the bootstrap instead of the seed. It creates regions, roles, profiles and
defaults – no fictitious data – and the first administrator:
```bash
pnpm db:deploy
BOOTSTRAP_ADMIN_EMAIL=you@company.example BOOTSTRAP_ADMIN_NAME="Your Name" BOOTSTRAP_ADMIN_PASSWORD='…' pnpm db:bootstrap
```
Then sign in, switch on two-step sign-in (avatar → Sign-in security) and continue with
[`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md).

## Scripts
| Command | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm lint` / `pnpm typecheck` | ESLint (incl. the unsafe-client import ban) / tsc |
| `pnpm test` | unit + integration (real Postgres: `TEST_DATABASE_URL`, else embedded Postgres) |
| `pnpm test:unit` / `pnpm test:integration` | one project only |
| `pnpm test:isolation` | the brand-isolation suite (model × persona matrix, VT-01…17, property-based) – required in CI |
| `pnpm test:idor` | IDOR scan of every `/api/v1` route with an id (Playwright) |
| `pnpm e2e` | Playwright (`pnpm exec playwright install chromium` once); uses `E2E_DATABASE_URL` or embedded Postgres |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Prisma |
| `pnpm db:local` | Docker-free local Postgres |
| `pnpm db:bootstrap` | production bootstrap: roles, profiles, defaults and the first administrator (no demo data) |
| `scripts/backup.sh` | daily encrypted database backup (see docs/SECURITY.md §4) |

## What is in the box
Leads, accounts & contacts, deals with pipelines and Blueprint, products and price books, quotes / sales orders /
invoices, activities and test drives, approvals and workflow automation, reports / dashboards / forecasts, e-mail /
SMS / WhatsApp and campaigns, cases with SLA, import / export / custom fields, REST API with tokens and webhooks,
ERP and payment adapters, vehicle and parts inventory per brand with journals, an installable mobile app with
offline quick actions, global search and a notification centre – all behind the same brand-isolation layer.

Honest status: there is **no hosted deployment** in this repository; the ERP / payment adapters and web push are
tested against mocks only; no penetration test has been done. See docs/SECURITY.md → "Known limitations".
