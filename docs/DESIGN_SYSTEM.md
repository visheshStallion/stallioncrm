# StallionCRM – Design system

The UI follows the layout patterns CRM users already know (module rail, list / kanban / detail templates, dense
tables) so the sales team moving from Zoho CRM feels at home. It is **inspired by, not copied**: our own branding,
open-source icons (lucide-react) and an open font (Inter). No third-party CRM names, logos, icons, fonts or CSS are used.

## 1. Tokens (`src/app/globals.css`)
CSS variables on `:root` (light) and `.dark`, exposed to Tailwind through `@theme inline`.

| Token | Light | Use (Tailwind class) |
|---|---|---|
| `--primary` / `--primary-hover` | `#1565D0` / `#114FA3` | buttons, links, active states (`bg-primary`, `text-primary`) |
| `--surface` | `#FFFFFF` | cards, tables, forms (`bg-surface`) |
| `--canvas` | `#F4F6F9` | app background (`bg-canvas`) |
| `--sidebar-bg` / `-fg` / `-active-bg` | `#1F2A3C` / `#C9D1DD` / `#2E3B52` | module rail (`bg-sidebar`, …) |
| `--border` | `#E3E7ED` | hairline borders |
| `--text` / `--text-muted` | `#1F2937` / `#5B6472` | text (`text-text`, `text-text-muted`) |
| `--success` `--warning` `--danger` `--info` | `#1E9E5A` `#F59E0B` `#E5484D` `#0EA5E9` | pills, toasts |
| `--row-height` | 40 px (32 px compact) | table rows |

Deviations from the starting values in the brief, made for WCAG AA contrast (checked by axe in CI): primary is
`#1565D0` instead of `#1A73E8`, muted text `#5B6472` instead of `#6B7280`, and status pills use darker text shades on
their tinted fills.

- **Font**: Inter Variable (self-hosted via `@fontsource-variable/inter`), fallback Lato / system-ui. 13 px tables,
  14 px forms, 20 px page titles.
- **Radius / shadow**: 4 px controls, 6 px cards; shadows only on popovers, drawers and dialogs.
- **Theme**: light, dark or system – stored per user (`UserPreference` key `theme`), applied as `.dark` on `<html>`.
- **Density**: comfortable / compact (`data-density` on `<html>`, key `density`).
- **Brand colours** come from the Brands master (`Brand.color`): `BrandBadge`, kanban card stripe, record header stripe.
- **Formats** (`src/lib/format.ts`): `₦ 12,500,000.00`; dates `DD/MM/YYYY` by default (user preference `dateFormat`),
  time zone Africa/Lagos.

## 2. App shell (`src/components/crm/AppShell.tsx`)
- **Module rail** (`ModuleRail`): dark, collapsible (64 px / 220 px). Order in `nav-config.ts`; only modules the
  profile can read are listed; unpinned ones sit under “More”. *Customize* lets each user reorder and pin (key `rail`).
  When one brand is selected in the switcher, that brand is shown at the top of the rail.
- **Top bar** (52 px): `BrandSwitcher` (brand + region – narrow, never widen), `GlobalSearch` (Ctrl/⌘+K palette over the
  scoped search API), `QuickCreateMenu` (“+”, drawers with mandatory fields for Lead and Deal), notifications bell,
  calendar shortcut, Setup gear (administrators only), `AvatarMenu` (theme, density, date format, sign out).
- No breadcrumbs: each page has a title row with the view selector and actions.

## 3. Page templates
| Template | Building blocks | Reference page |
|---|---|---|
| List (`ModuleListPage`) | `ModuleListFrame`, `ViewSelector`, `CreateSplitButton`, `ActionsMenu`, `LayoutToggle`, `FilterPanel`, `DataTable`, `Pagination` | `src/app/(crm)/deals/page.tsx`, `leads/page.tsx` |
| Kanban (`ModuleKanban`) | `Kanban` – “Stage · count · ₦ total”, brand stripe, drag or “Move to”, collapse, *Kanban by* | `deals/DealsView.tsx`, `leads/LeadsView.tsx` |
| Record detail (`RecordDetailPage`) | `RecordHeader`, `StageProgressBar`, `DetailTabs`, `RelatedNav`, `FieldSection`, `Field` / `MaskedField`, `RelatedListCard`, `Timeline`, `RecordNav` | `deals/[id]/page.tsx`, `leads/[id]/page.tsx` |
| Form (`RecordFormPage`) | `FormSection`, `Required`, `StickyFormFooter` ([Cancel] [Save and New] [Save]), `QuickCreate` drawer | `leads/new/page.tsx`, `leads/[id]/edit/page.tsx` |
| Home | widget grid, per-role defaults (managers get team pipeline + pipeline by brand) | `src/app/(crm)/page.tsx` |
| Setup | `SetupLanding` (searchable category grid), `SetupLayout` (two panes) | `src/app/(crm)/admin/*` |

### List behaviour
- **Views**: system views + the user's saved views; “Save as custom view” stores filters (and field conditions).
- **Filter panel**: search, system-defined filters (touched / untouched), and field filters with operators (is, isn't,
  contains, starts with, is empty, between, in the last N days, greater / less than). Conditions travel in the URL as
  `f=field~op~value` and are validated against the module's field whitelist in `src/server/list/filters.ts`; the result
  is ANDed with the access scope, so a filter can only narrow.
- **DataTable**: sorting, sticky header, frozen first column, column chooser with drag reorder (saved per user as
  `columns:<module>`), row selection → bulk bar, double-click inline edit for permitted fields, hover quick actions,
  virtualised above 500 rows.
- **Pagination**: “Total Records N”, 10 / 20 / 50 / 100 per page.

## 4. Conventions
- Primary action top-right in blue (“Create Lead”); secondary operations in **Actions ▾**.
- Keyboard: Ctrl/⌘+K search · `c` create · `e` edit · `/` focus filter search · `j` / `k` next / previous record.
  Pages opt in with `data-shortcut="create|edit|filter|next|prev"`.
- Toasts bottom-centre; `ConfirmDialog` (or a confirm prompt) for destructive actions.
- **Multi-brand cues**: `BrandBadge` on every brand-owned row, card and record header. Lists contain only accessible
  data – never render counts, placeholders or “hidden” hints for other brands.
- Access checks stay on the server (`assertCan`, `scopedDb`); components only decide what to *show*.

## 5. Component library (`src/components/crm/`)
`AppShell`, `ModuleRail`, `BrandSwitcher`, `GlobalSearch`, `QuickCreateMenu`, `ViewSelector`, `FilterPanel`,
`Pagination`, `LayoutToggle`, `CreateSplitButton`, `ActionsMenu`, `RecordHeader`, `StageProgressBar`, `DetailTabs`,
`RelatedNav`, `FieldSection`, `Field`, `MaskedField`, `EditableField`, `RelatedListCard`, `Timeline`, `ActivityItem`,
`FormSection`, `StickyFormFooter`, `OwnerPicker`, `LookupField`, `Picklist`, `MultiPicklist`, `CurrencyInput`,
`DateRangePicker`, `StatusPill`, `Avatar`, `AvatarStack`, `EmptyState`, `ApprovalBanner`, `DropdownMenu`, `Drawer`,
`ConfirmDialog`, `SetupLayout`, `SetupLanding`, `KeyboardShortcuts`, `RecordNav`; plus `DataTable`, `Kanban`,
`BrandBadge`, `RegionBadge`, `Toaster` in `src/components/`.

**Storybook**: `pnpm storybook` (dev) / `pnpm build-storybook`. Stories live in `src/components/crm/stories/`; the
toolbar switches light / dark and comfortable / compact. Next.js routing and server actions are mocked in
`.storybook/mocks`.

## 6. Responsive & accessibility
- ≥ 1280 px full layout; the rail collapses to icons on demand; below 768 px the rail is hidden (the mobile layout
  arrives with prompt 14).
- WCAG 2.1 AA: axe runs on Home, Deals (list + kanban), Leads (list + form) and Setup in the e2e suite and fails on
  serious / critical violations. Focus rings, labelled controls, keyboard alternative to drag (“Move to” on kanban
  cards), `prefers-reduced-motion` respected.

## 7. Quality checks
- `pnpm e2e` – behaviour, isolation, shell and accessibility tests.
- `pnpm e2e:visual` – screenshot baselines (list, kanban, record detail, form, home, setup × light / dark) in
  `tests/visual/*-snapshots`. Baselines are per platform; after an intentional UI change run
  `pnpm e2e:visual --update-snapshots` and commit them.

## 8. Not yet covered
Lighthouse scoring is not automated (axe covers accessibility), column drag is in the chooser rather than on the table
header, the filter panel does not turn into a drawer on tablets, mass delete / mass email / tags wait for their
modules, and the notification feed, calendar and approvals widgets are placeholders until prompts 07, 08 and 14.
