# Security

How StallionCRM protects data, what is verified automatically, and what is **not** done yet. The single most
important property is **brand isolation**: a user of one brand must never read or change another brand's data
through any path.

## 1. Brand isolation – how it is enforced and how it is tested

Two independent layers (see ARCHITECTURE §3 and ADR 0001):

1. **Application** – every query of application code goes through `scopedDb(ctx)`, which adds the visibility
   rule (BUSINESS_CONTEXT §5) to every read and write; importing the unscoped client outside
   `src/server/db/**` is a lint error.
2. **Database** – PostgreSQL row-level security on every brand-owned and brand-tagged table, with the same rule
   written in SQL. Application sessions run as role `stallion_rls`; without a user context RLS returns nothing.

Automated verification (`pnpm test:isolation`, a required CI step):

| Test | What it proves |
|---|---|
| `tests/isolation/matrix.test.ts` – model matrix | For **every** brand-owned model (detected from the schema) and 11 personas, the scoped client, `count`, get-by-id and raw SQL under RLS return exactly the rows an independent reference implementation of the rule allows. The fixture (2 brands × 2 regions, all personas, rows of every model) is generated per run. |
| … – access paths | List, get by id, related lists, attachment download, global search (name and VIN), export, report, dashboard, webhook payload, notification, offline snapshot – per persona. |
| … – VT-01 … VT-17 | The go-live visibility tests of BUSINESS_CONTEXT §11, by name. |
| `tests/isolation/property.test.ts` | Property-based: random users with random territories, random records; scoped client ≡ reference ≡ RLS, and no write reaches a hidden record. Seeded (`ISOLATION_SEED=<n>` replays a failure). |
| `tests/e2e/zz-idor.spec.ts` (`pnpm test:idor`) | IDOR scan against the running application: every `/api/v1` route with an `[id]`, discovered from the file system, is called with ids of another brand. The answer must be 404 – or identical to the answer for a non-existent id – and never a success. A new route fails the scan until it is given an id source or an exemption with its reason. |
| Module tests | Each module's own isolation tests (leads, deals, documents, cases, inventory, API tokens, webhooks, search, offline). |

Re-run the suite after every new module; a new brand-owned model is picked up automatically by the model matrix
(and fails it until the fixture creates rows for it).

## 2. Controls

**Admin tiers and four eyes (prompt 19).** Setup is tiered: Super Admin (a flag that only the Setup service can
set – a database trigger refuses any change from a user session – and that requires the Administrator profile),
Administrator, delegated Brand Admin (own brand only) and per-profile setup permissions for functions that can be
delegated. Every Setup page and service checks the tier of its catalogue entry and answers 404 outside it.
Destructive operations (purge, mass delete, sample-data removal, authentication-policy changes, revoking a Super
Admin, disabling an administrator) need the requester's re-authentication and a second Super Admin's
re-authenticated approval; both are in the audit log. The last active Super Admin cannot be disabled or demoted
(service check and database trigger). Password policy, MFA-by-profile and session length are organisation
settings; a configuration import that would change one of them is refused.

| Area | Control |
|---|---|
| Authentication | Password (argon2id) and/or Microsoft Entra ID SSO (no auto-provisioning). Generic error for unknown user / wrong password. |
| Brute force | Failed sign-ins are throttled per IP and per account (in-memory window) and the account is **locked for 15 minutes after 5 consecutive failures** (in the database – survives restarts and applies across instances). Administrators unlock in *Access review*. Every failure is in the audit log with its reason. |
| Two-step sign-in | Optional TOTP (RFC 6238) per user (avatar → *Sign-in security*). The secret is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`) and is not selectable from user sessions. Administrators can reset it. Not enforced by policy – see §4. |
| SSO only | `AUTH_SSO_ONLY=1` refuses password sign-in except for the break-glass addresses in `AUTH_PASSWORD_LOGIN_ALLOW`. |
| Sessions | JWT session cookie, `HttpOnly`, `SameSite=Lax`, `Secure` on https, 12-hour lifetime. The access context (profile, territories) is rebuilt on every request, so a change of access or a deactivation takes effect immediately. |
| CSRF | Server actions: Next.js origin check. JSON API: state-changing requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are refused (middleware). Bearer-token requests carry no cookie. |
| Authorisation | Profile permissions per module and action; visibility rule per record; field-level security (hidden / masked / read-only) on reads (API, exports, webhooks, screens) and on writes (non-editable fields are dropped from updates). Hidden records answer 404. |
| API tokens | SHA-256 hashes only; per-token rate limit; optional brand narrowing; idempotency keys; tokens cannot manage tokens or sign-in security. |
| Input validation | Zod schemas on every service input; Prisma parameterised queries; raw SQL only with bound parameters in the report engine; file uploads restricted by type and size; formula fields use a parser, not `eval`. |
| Output | React escaping; no `dangerouslySetInnerHTML` with user data; CSV exports prefix formula characters. |
| Headers | CSP (`default-src 'self'`, no framing, no plugins, same-origin forms), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production. |
| SSRF | Outbound webhooks: https and public addresses only. |
| Secrets | Environment only (`.env` is git-ignored; `.env.example` holds names, never values). Logs redact passwords, tokens, secrets, cookies and authorization headers. |
| Audit | Every create / update / delete of brand-owned records, sign-ins, exports, imports, approvals, permission and territory changes. The audit log is **append-only**: no grants for user sessions and a trigger that refuses UPDATE / DELETE for every role. |
| Inventory & finance | Stock ledger append-only, journals immutable and balanced (triggers), period lock. |
| Privacy | Seed and tests use fictitious data only; real employee / customer files are git-ignored and must not be committed (the repository is public). Customer contact details are masked by tier for users without a relationship. |
| Dependencies | `pnpm audit --prod --audit-level high` runs in CI. |
| Monitoring | `/api/public/health` (application + database), structured JSON logs (pino), optional Sentry-compatible error tracking (`SENTRY_DSN`) that sends the error and route only. |

## 3. OWASP ASVS 4.0 Level 2 – status

Status: ✔ implemented and tested · ◐ partly · ✘ not done.

| # | Chapter | Status | Notes |
|---|---|---|---|
| V1 | Architecture | ✔ | Central access layer (`scopedDb`, `can`, `fieldMask`), RLS as second layer, ADR 0001. No formal threat model document. |
| V2 | Authentication | ◐ | Argon2id, lockout, throttling, optional TOTP, SSO. **Missing:** password-strength / breached-password check beyond a 10-character minimum, self-service password reset by e-mail, enforced MFA for administrators, recovery codes. |
| V3 | Session management | ◐ | Secure cookie attributes, 12 h lifetime, logout. **Missing:** idle timeout shorter than the lifetime, list / revoke of other sessions (JWT sessions cannot be revoked individually; deactivating the user or changing their access takes effect at once). |
| V4 | Access control | ✔ | Deny by default, 404 for hidden records, isolation suite, IDOR scan, field-level security read + write. |
| V5 | Validation, sanitisation, encoding | ✔ | Zod everywhere, parameterised SQL, safe formula parser, CSV injection guard. |
| V6 | Stored cryptography | ◐ | Argon2id; AES-256-GCM for backups and TOTP secrets; token hashes. **Missing:** key rotation procedure for `AUTH_SECRET` (rotating it invalidates sessions and stored TOTP secrets); database encryption at rest is the hosting platform's job. |
| V7 | Error handling & logging | ✔ | Generic error responses, structured logs with redaction, audit log, error tracking hook. |
| V8 | Data protection | ◐ | Masking by tier, no data in caches (service worker stores no API response), `no-store` on downloads. **Missing:** data-retention / deletion policy and tooling (NDPR requests are manual). |
| V9 | Communication | ◐ | HSTS header in production. TLS termination and certificate management are the hosting platform's job. |
| V10 | Malicious code | ✔ | Lockfile, CI audit, no dynamic code execution. |
| V11 | Business logic | ✔ | Approvals, blueprint, status machines, idempotency, rate limits on public forms and tokens. |
| V12 | Files & resources | ◐ | Type / size limits, brand-prefixed storage keys, downloads as attachments with `nosniff`. **Missing:** malware scanning of uploads. |
| V13 | API | ✔ | Same access model as the UI, OpenAPI, token scoping, IDOR scan, CSRF check. |
| V14 | Configuration | ◐ | Security headers, no version headers, secrets in env. **CSP allows inline scripts** (`'unsafe-inline'`) because the framework renders inline bootstrap scripts; a nonce-based CSP is not implemented. |

**Print and e-mail (prompt 20).** Printouts, PDFs and e-mails are built from records loaded with the user's scoped
client and field mask – hidden records are 404, masked fields stay masked. A brand-owned record always carries its
own brand's letterhead and sender; neither can be chosen through a parameter. Merge fields resolve only from the
record at hand. All rich text (templates, e-mail bodies, signatures) passes one sanitiser (no scripts, iframes,
forms, event handlers, `javascript:` links); previews render in sandboxed frames. List and bulk prints of customer
modules need the export permission. Every print, PDF and sent e-mail is audited.

**Document templates (prompt 21).** Templates and stored copies live in tables that user sessions cannot read; the
service decides visibility (own personal templates, published templates of the user's brands, group templates).
A template is compiled for a record that was loaded with the user's access and always carries the record's own
brand letterhead; a template of another brand, another module or another person answers 404 at print and send
time. Personal templates cannot produce financial documents. Shared templates are published by the Brand Admin
or an administrator (brand managers go through the approval engine). Generated PDFs are stored under a
brand-scoped key with a SHA-256 checksum and are immutable (database trigger); reading one requires access to
its record. Page CSS is limited to an allow-list of declarations.

### Known limitations (read before go-live)

- Rate limits (sign-in, tokens, public forms) are **per server process**. Behind several instances put a shared
  limiter (gateway / Redis) in front; the account lockout is in the database and is not affected.
- No independent penetration test has been performed. The automated suites test the access model; they are not a
  substitute for one.
- The ERP and payment adapters have been tested against mock servers only (API.md §4).
- Web push has not been exercised against a real push service in automated tests.
- Field-level security is applied on screens for leads, customers, deals, cases and documents; aggregated values
  in **reports and dashboards** still include fields a profile hides on the record (e.g. deal amount in pipeline
  totals). Do not rely on field hiding to keep totals confidential.
- Inventory cost visibility is enforced by the application (`inventoryFinance`), not by row-level security: RLS
  separates brands, not cost tiers.
- **Setup (prompt 19)**: sharing rules are validated and stored but **not applied** by the access engine; there is
  no limit on concurrent sessions and no idle timeout (only a maximum session length); no allowed-IP ranges, no
  field encryption at rest, no impersonation ("login as"), no invitation e-mails. Re-authentication for destructive
  operations is throttled per server process, like the other rate limits. See SETUP_CATALOGUE.md for every
  function's status.

## 4. Backups and restore drill

- **Daily database backup:** `scripts/backup.sh` (pg_dump → gzip → AES-256 with `BACKUP_PASSPHRASE`, 30 daily
  files kept). Run it from cron / the platform scheduler on the database host or a job runner:
  `0 1 * * * BACKUP_DIR=/var/backups/stallioncrm DATABASE_URL=… BACKUP_PASSPHRASE=… /app/scripts/backup.sh`.
  Copy the files off the host (object storage with versioning). The passphrase lives in the secret manager, not
  next to the backups.
- **File storage** (attachments, exports, ERP outbox): back up the storage bucket / directory with the same schedule.
- **Application-level backup:** Exports → *Full backup* gives administrators an encrypted zip of CSVs – useful for
  hand-over, not a replacement for database backups.
- **Restore drill (quarterly, and before go-live):**
  1. Create an empty database: `createdb stallioncrm_restore`.
  2. `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in <file>.sql.gz.enc | gunzip | psql stallioncrm_restore`.
  3. Point a staging instance at it (`DATABASE_URL`), run `pnpm db:deploy` (no pending migrations expected).
  4. Sign in as an administrator and as one executive per brand; compare record counts per brand with production
     (Reports → Pipeline by stage and brand); run `pnpm test:isolation` against a **copy** of the restored database
     (`TEST_DATABASE_URL`) – the suite creates its own fixture brands and never touches existing rows, but it does
     write, so never point it at production.
  5. Record date, duration and result. A backup that has not been restored is not a backup.

## 5. Reporting a vulnerability

Do not open a public issue. Write to the repository owner privately with the steps to reproduce; expect an
acknowledgement within three working days.
