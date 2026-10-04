# StallionCRM – Business Context (shared by every prompt)

> Prompt 00 commits this file to the repo as `docs/BUSINESS_CONTEXT.md`.
> Every later prompt says "read docs/BUSINESS_CONTEXT.md first". Keep it the single source of truth.

## 1. What we are building
A multi-brand automotive sales CRM (a Zoho CRM replacement) for one dealer group that sells up to
**10 vehicle brands**, each a separate legal entity. Brands must be walled off from each other:
sales managers and sales executives see **only their own brand's** sales data, while group
management and regional staff see across brands according to the rules below.

**Design principle:** ONE database, ONE login per person. The customer is **shared**; every sales
transaction is **owned by exactly one brand**. Visibility is driven by **territories (Brand x Region)**.

## 2. Brands (Brands master – 10 slots)

| # | Brand code | Make / name | Status |
|---|---|---|---|
| 1 | HMNL | Hyundai | Active |
| 2 | SNMNL | Nissan | Active |
| 3 | SMGL | MG | Active |
| 4 | THPL | THPL | Active |
| 5 | ZANL | ZANL | Active |
| 6–10 | BRAND6 … BRAND10 | Future brands | Future |

Each brand row holds: code (unique), display name, legal entity, brand manager (user), ERP/Books
company code, logo, status (Active / Future / Inactive), document number prefix.

### Legacy company-code mapping (from the HR rep list – must be configurable, not hard-coded)

| Code in rep file | Maps to brand | Note |
|---|---|---|
| HMNL | HMNL | same |
| SNMN | SNMNL | Nissan |
| SNML | SNMNL | Nissan – second code, confirm |
| MG | SMGL | MG |
| SML | SMGL | 2 reps only – confirm |
| THP | THPL | |
| ZAHAV | ZANL | confirm |

## 3. Regions
`Lagos` (head office), `Abuja`, `Port Harcourt`, `Ibadan`. Regions are a managed list (admin can add).

## 4. Organisation chart

```
Managing Director (all brands)
 └── Head of Sales (all brands)
      ├── Brand Manager – HMNL ─┐
      ├── Brand Manager – SNMNL ├─► Lagos Sales Execs (own brand only)
      ├── Brand Manager – SMGL  │
      ├── Brand Manager – THPL  │
      ├── Brand Manager – ZANL ─┘
      │        ▲ (each brand manager sees regional deals for their own brand)
      └── Regional Sales Manager (all brands; reports to every brand manager)
             ├── Sales Execs – Abuja (all brands)
             ├── Sales Execs – Port Harcourt (all brands)
             └── Sales Execs – Ibadan (all brands)
CRM Administrator (IT) – outside the sales chart, full setup rights
```

Sizing: ~89 sales & management users today (80 reps + MD, Head of Sales, RSM, CRM Admin,
5 brand managers); design for 10 brands / 300 users. 31 reps sell 2+ brands.

## 5. Territories (the visibility engine)

```
Group – All Brands                    (MD, Head of Sales, CRM Admin)
└── <BRAND>                            (manager: that brand's Brand Manager)
    ├── <BRAND> – Lagos                (Lagos execs of that brand)
    ├── <BRAND> – Abuja                ┐
    ├── <BRAND> – Port Harcourt        ├ RSM + regional execs of that region
    └── <BRAND> – Ibadan               ┘
```
1 root + 10 brand + 40 brand-region territories. A user can belong to MANY territories.
Territory auto-assignment rule for a record: `brand = X AND region = Y  →  territory "X – Y"`.

### Visibility rule (implement once, centrally, and enforce in DB too)
A user can READ a brand-owned record (lead, deal, quote, sales order, invoice, activity, case) if ANY of:
1. user has `scope = ALL` (Management, Administrator profiles), or
2. user is the record owner, or
3. user has a territory membership where `membership.brand_id = record.brand_id` AND
   (`membership.region_id IS NULL` (brand-level, e.g. Brand Manager) OR `membership.region_id = record.region_id`).

WRITE requires READ + profile permission for that module/action.
Shared master data (Accounts/Contacts, Products, Price Books): see §8.

## 6. Roles (reporting line) and Profiles (permissions)

| Role | Reports to | Profile | Territory memberships |
|---|---|---|---|
| Managing Director | – | Management | Root (scope ALL) |
| Head of Sales | MD | Management | Root (scope ALL) |
| Brand Manager | Head of Sales | Brand Manager | `<BRAND>` (brand-level, region NULL) |
| Lagos Sales Exec | Brand Manager | Sales Exec | `<BRAND> – Lagos` for each brand they sell |
| Regional Sales Manager | Head of Sales (+ dotted to all Brand Managers) | RSM | every `<BRAND> – <Region>` for Abuja/PH/Ibadan |
| Regional Sales Exec | RSM | Sales Exec | `<BRAND> – <their region>` for every brand they sell |
| CRM Administrator | IT | Administrator | Root (scope ALL) |

Brand is NEVER encoded in a profile – 5 profiles serve all 10 brands.

## 7. Permission matrix

| Capability | Sales Exec (Lagos) | Sales Exec (Regional) | Brand Manager | RSM | Management | Administrator |
|---|---|---|---|---|---|---|
| See own brand deals | Own territory | Own region, all brands | Whole brand | All regions, all brands | All | All |
| See other brands' deals | No | Own region only | No | Regions only | All | All |
| See shared customers | Basic fields | Basic fields | Basic fields | Basic fields | Full | Full |
| Create / edit leads & deals | Yes | Yes | Yes | Yes | View | Yes |
| Create quotes / sales orders | Yes | Yes | Yes | Yes | View | Yes |
| Change Brand on a record | No | No | Via approval | No | Yes | Yes |
| Approve discounts | No | No | Own brand | Up to limit | Final | – |
| Reports & dashboards | Own deals | Own region | Own brand | Regions | All brands | All |
| Export data | No | No | Own brand | Yes | Yes | Yes |
| Mass update / mass email | No | No | Yes | Yes | Yes | Yes |
| Delete records | No | No | No | No | No | Yes |
| Setup / customization | No | No | No | No | No | Yes |

## 8. Data ownership & sharing

| Data | Ownership | Default sharing |
|---|---|---|
| Brands, Regions, Territories, Users | Admin | Admin edit; all read own context |
| Accounts / Contacts (customers) | **Shared** across brands, one record per customer | Public read-only for **basic fields** (name, city, masked phone); sensitive fields (full phone, email, KYC, credit, address) visible only to users who can see at least one of that customer's brand records, or Management |
| Leads | Brand-owned | Private → territory rule |
| Deals, Quotes, Sales Orders, Invoices | Brand-owned (brand + region mandatory, inherited Lead → Deal → Quote → SO → Invoice) | Private → territory rule |
| Activities (tasks, calls, meetings, test drives) | Inherit brand from parent record | Private → territory rule |
| Cases (complaints) | Brand-owned | Private → territory rule |
| Products (models/variants), Price Books | Brand-tagged | Read-only, filtered: a record can only reference products/price books of its own brand |

Rules: Brand is mandatory on every transaction, auto-filled from the user's single brand or the lead
source, **read-only for Sales Execs**; brand change requires approval by BOTH brand managers and is audited.

## 9. Automotive sales process (Blueprint – one pipeline per brand, same default stages)
`Enquiry → Test Drive → Quotation → Booking → Finance / Payment → Delivery → Closed Won | Closed Lost`
Mandatory on entering stage: Test Drive (date, model), Quotation (a quote exists), Booking (deposit amount
+ receipt no.), Delivery (VIN/chassis no., delivery date), Closed Lost (loss reason).

## 10. Automation defaults
- Lead assignment: brand + region → round-robin among active members of that brand-region territory.
- Web form per brand (hidden brand field, region picklist).
- Discount approval: > 3% → Brand Manager of the record's brand; > 7% → Head of Sales (thresholds configurable per brand).
- Stale deal: no update for 7 days → task to owner + notification to Brand Manager.
- Quote / Sales Order inherit brand + region from Deal.

## 11. Go-live visibility tests (must pass – see prompt 15)
17 cases, e.g. HMNL Lagos exec cannot find an SNMNL deal by list, search, report, related list, API
or export; Abuja exec sees all brands but only Abuja; Brand Manager sees all regions of own brand only;
Head of Sales sees consolidated data; brand change creates approval + audit entry.

## 12. Privacy
The repository is PUBLIC. Never commit real employee or customer data. Real users are imported at
runtime through the admin CSV import (prompt 01). Seed data must be fictitious.
