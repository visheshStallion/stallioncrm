# Migrating from Zoho CRM

This is the runbook for moving the data of the five brands from Zoho CRM into StallionCRM with the import wizard
(**Setup → Data Administration → Import data**, `/imports`). Nothing here needs developer access.

> **Privacy.** Exports from Zoho contain real customer and employee data. Keep them outside the repository
> (the repo ignores `/private` and `/imports/**/*.csv`, but the safest place is not inside the checkout at all)
> and delete them when the migration is signed off.

## 1. Before you start

1. **Brands and aliases.** Setup → Brands: every legacy company code used in the Zoho data (the codes of the
   sales-rep file, old short names) must be listed as an *alias* of its brand. The wizard resolves the brand of
   each row through code → alias → name; a row whose brand cannot be resolved is an error, never a guess.
2. **Users.** Import the users first (Setup → Users → Import users). Owners are matched by **email**; a row
   whose owner is unknown or cannot see the row's brand and region is imported with a warning and assigned by
   the normal assignment rules.
3. **Pipelines.** Check each brand's stages (Setup → Pipelines & Blueprint). Zoho's standard stage names are
   mapped automatically (table below); anything else needs a value mapping in step 2 of the wizard.
4. **Products.** Import products before deals so that "Model" columns resolve.
5. **Custom fields.** Create the custom fields you want to keep (Setup → Fields & layouts) before importing.

## 2. Export from Zoho

In Zoho: *Setup → Data Administration → Export*, one module at a time, as CSV. Files above 5,000 rows or 5 MB
must be split (keep the header row in every part).

## 3. Order of the imports

| # | Module | Identifies an existing record by | Notes |
|---|--------|----------------------------------|-------|
| 1 | Products | product code | per brand |
| 2 | Accounts | name | shared between brands – no brand column needed |
| 3 | Contacts | mobile, email | linked to the account by account name |
| 4 | Leads | mobile, email (within the brand) | open leads only; converted leads arrive as contacts + deals |
| 5 | Deals | deal name (within the brand) | needs brand, region, stage |
| 6 | Price books | product code (within the book) | prices per brand |
| 7 | Activities | — | optional; linked to the deal or lead by name |

## 4. The wizard

1. **Upload** the CSV or XLSX. Nothing is written yet.
2. **Mapping.** Zoho's column names are recognised (`Last Name`, `Mobile`, `Lead Source`, `Deal Name`, `Stage`,
   `Closing Date`, `Amount`, `Deal Owner`, `Company Code` …); check the suggestions and set the rest. Values
   that differ are mapped one per line, e.g. `source: Cold Call = PHONE`. Choose what happens when a record
   already exists (skip / update / create a duplicate) and the default brand and region for files without those
   columns. Save the mapping as a **template** to reuse it for the next file.
3. **Dry run.** The summary shows how many rows will be created, updated and skipped, the brand resolved for
   every row and each problem with its row number. Fix the file or the mapping and run it again – as often as
   needed.
4. **Start import.** The import runs in the background (rows with errors are left out). The result lists what
   was created per brand and every row that failed.
5. **Undo.** An import can be undone from the history: the records it *created* are deleted (updates are not
   reverted). Undo before users start working on the records.

### Zoho stage → StallionCRM stage

| Zoho | StallionCRM |
|------|-------------|
| Qualification, Needs Analysis | Enquiry |
| Value Proposition, Identify Decision Makers | Test drive |
| Proposal/Price Quote | Quotation |
| Negotiation/Review | Booking |
| Closed Won | Closed won |
| Closed Lost, Closed-Lost to Competition | Closed lost |

## 5. Who may import what

- **Administrators** import into any brand.
- **Brand Managers** import into their own brand only. A row for another brand is rejected in the dry run
  ("You cannot import into brand …") – it is never silently moved to the manager's brand.
- Everyone else has no access to the wizard. Every import and undo is in the audit log.

## 6. Checks after the migration

- Counts per brand: compare the result page with Zoho's module counts, then the reports "Pipeline by stage and
  brand" and "Leads by source".
- Log in as one executive per brand and confirm they see their own brand's records only.
- Take a **full backup** (Exports → Full backup) once the data is verified.

## 7. Exports and backups

- List views export to CSV or XLSX (`/exports`, or "Export view" on a list). An export contains only what the
  user can see, with masked fields masked, and is audited. Above `EXPORT_SYNC_LIMIT` rows (default 2,000) it is
  built in the background; the download link expires after 24 hours.
- **Full backup** (administrators): one CSV per table in a zip, encrypted with AES-256-GCM from a passphrase
  that is not stored anywhere. Decrypt with `pnpm backup:decrypt <file.zip.enc> <out.zip>` (the passphrase is
  read from `BACKUP_PASSPHRASE` or asked on the terminal). Password hashes and other secrets are not part of the backup.
