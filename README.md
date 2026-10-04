# StallionCRM

Multi-brand automotive sales CRM (a Zoho CRM replacement) for a dealer group with up to 10 vehicle brands.
The core property is **brand isolation**: a user never reads or changes sales data of a brand they are not
entitled to – via UI, search, reports, exports, related lists or the API.

- Business rules: [`docs/BUSINESS_CONTEXT.md`](docs/BUSINESS_CONTEXT.md)
- How it is enforced and how to add a module: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decision record: [`docs/adr/0001-brand-isolation.md`](docs/adr/0001-brand-isolation.md)

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

pnpm dev                         # http://localhost:3000
```
The database role in `DATABASE_URL` must be allowed to create a role on first migration (it creates the NOLOGIN
role `stallion_rls` used for Row-Level Security). The default `postgres` user is fine locally.

### Demo logins (fictitious seed – password `Stallion!2026`)
| Email | Role | Sees |
|---|---|---|
| `md@stallioncrm.test` | Managing Director | everything |
| `admin@stallioncrm.test` | CRM Administrator | everything + setup |
| `bm.hmnl@stallioncrm.test` | Brand Manager HMNL | HMNL, all regions |
| `exec.hmnl.1@stallioncrm.test` | Lagos Sales Exec | HMNL – Lagos |
| `exec.multi.1@stallioncrm.test` | Lagos Sales Exec (multi-brand) | HMNL + SNMNL – Lagos |
| `rsm@stallioncrm.test` | Regional Sales Manager | all brands, Abuja / Port Harcourt / Ibadan |
| `exec.abuja@stallioncrm.test` | Regional Sales Exec | all brands, Abuja |

See `prisma/seed-data.ts` for all 25 users.

## Scripts
| Command | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm lint` / `pnpm typecheck` | ESLint (incl. the unsafe-client import ban) / tsc |
| `pnpm test` | unit + integration (real Postgres: `TEST_DATABASE_URL`, else embedded Postgres) |
| `pnpm test:unit` / `pnpm test:integration` | one project only |
| `pnpm e2e` | Playwright (`pnpm exec playwright install chromium` once); uses `E2E_DATABASE_URL` or embedded Postgres |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Prisma |
| `pnpm db:local` | Docker-free local Postgres |

## Build prompts
Modules are built one prompt at a time (00 → 15), one PR each. This PR is prompt 00: foundation, access engine,
RLS, app shell and seed – no business modules yet.
