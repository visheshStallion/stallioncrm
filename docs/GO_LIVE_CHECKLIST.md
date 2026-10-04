# Go-live checklist

Work through this list in order. Every line has an owner and a date in the project plan; nothing is ticked on
trust – the evidence (screenshot, report, test run) is attached to the sign-off.

## 1. Environment

- [ ] Production database (PostgreSQL 16) with daily encrypted backups (SECURITY.md §4) and a **successful
      restore drill**.
- [ ] Application on https with a valid certificate; `AUTH_URL` / `APP_URL` set; `AUTH_SECRET` generated
      (`openssl rand -base64 48`) and stored in the secret manager.
- [ ] `pnpm db:deploy` run; **the seed is NOT run in production** (it creates fictitious users with a public
      password).
- [ ] First administrator created (see README → "First administrator"); password changed; two-step sign-in on.
- [ ] Scheduler calls `POST /api/public/cron/tick` every minute with `CRON_SECRET` (reminders, SLA escalation,
      approvals, exports, reservation expiry, digests).
- [ ] Mail settings and, per brand, the sender identity (Setup → Brands); test message received.
- [ ] File storage configured and backed up.
- [ ] `/api/public/health` monitored by the uptime service (alert when not 200 for 2 minutes); logs shipped;
      `SENTRY_DSN` set if error tracking is used.
- [ ] Decide: `AUTH_SSO_ONLY=1` with Microsoft Entra ID for staff, break-glass accounts listed in
      `AUTH_PASSWORD_LOGIN_ALLOW`.

## 2. Organisation data (never in git)

- [ ] Brands created with the correct code, legal entity, document prefix, ERP company code, colours and logo.
- [ ] **Legacy company-code mapping confirmed** with HR / sales operations: every code in the rep list resolves to
      the right brand (Setup → Brands → aliases). Ambiguous codes are resolved by a person, not guessed.
- [ ] Regions and territories checked (one territory per brand and per brand–region).
- [ ] Users imported with the admin CSV import (Setup → Users → Import). The file stays outside the repository
      and is deleted afterwards.
- [ ] Each user has the right role, profile and territories; Brand Managers set on their brand; reporting lines set.
- [ ] Inventory staff have the inventory profiles and their brand territory.
- [ ] Pipelines, discount thresholds, SLA policies, business hours and holidays reviewed per brand.
- [ ] Products and price books loaded per brand; warehouses and vendors per brand; inventory account mapping and
      opening stock (goods receipts) entered by each Brand Accountant.

## 3. Data migration from Zoho

- [ ] Follow MIGRATION_FROM_ZOHO.md in a **staging** copy first: products → accounts → contacts → leads → deals.
- [ ] Dry-run reports reviewed per brand; row errors fixed in the source files.
- [ ] Counts per brand reconciled with Zoho; spot checks of 20 records per brand by the Brand Manager.
- [ ] Repeat in production in the agreed freeze window; import history kept.

## 4. Isolation and security verification

- [ ] CI is green on the release commit, including `pnpm test:isolation` and the IDOR scan.
- [ ] **Isolation suite run against a production-like snapshot**: restore last night's backup into a staging
      database and run `TEST_DATABASE_URL=<snapshot copy> pnpm test:isolation` (it writes fixture brands – use a
      copy, never production).
- [ ] Manual VT-01 … VT-17 walk-through on staging with real user accounts of two brands (BUSINESS_CONTEXT §11):
      an executive of brand A searches for a known deal of brand B, opens its address directly, exports, runs a
      report – nothing of brand B appears.
- [ ] Access review (Setup → Data Administration → Access review) exported and signed by each Brand Manager:
      every user, their brands and regions.
- [ ] Known limitations in SECURITY.md read and accepted by the project sponsor (rate limits per process, no
      penetration test yet, report totals and field hiding).
- [ ] Penetration test booked or risk accepted in writing.

## 5. Integrations (only those in scope)

- [ ] ERP adapter tested against the ERP **sandbox company of each brand**: a sales order and an invoice of brand A
      arrive in company A only; payment reconciliation works.
- [ ] Payment provider keys per brand; a test payment is booked on the invoice; webhook URL registered.
- [ ] WhatsApp / SMS provider numbers per brand; inbound routing checked.
- [ ] API tokens and webhooks created for integration principals with the narrowest profile and brands.

## 6. User acceptance per brand

- [ ] Brand Manager and two executives per brand complete the scripted day: lead → deal → quote (discount
      approval) → sales order → reserve vehicle → invoice → delivery; case with SLA; test drive.
- [ ] Sign-off by each Brand Manager; open defects triaged (no open defect of severity 1 or 2).
- [ ] Mobile: install on an Android phone and an iPhone; quick actions offline and sync.

## 7. Training and cut-over

- [ ] Training per role (executives, Brand Managers, inventory, administrators); quick reference shared.
- [ ] Cut-over plan: Zoho read-only from the freeze; final import; smoke test; go / no-go meeting.
- [ ] Support channel and named contacts for the first weeks; daily check of the automation run log, failed jobs,
      webhook deliveries and the audit log.

## 8. Hypercare (first 4 weeks)

- [ ] Daily: failed jobs, health alerts, error tracking, locked accounts.
- [ ] Weekly: access review of new users, import history, backup restore of one table as a spot check.
- [ ] End of week 4: retrospective, close of the Zoho subscription, schedule the quarterly access review and
      restore drill.
