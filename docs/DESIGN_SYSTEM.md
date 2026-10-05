# StallionCRM – Design system

The UI follows the layout patterns CRM users already know (module rail, list / kanban / detail templates, dense
tables) so the sales team moving from Zoho CRM feels at home. It is **inspired by, not copied**: our own branding,
open-source icons (lucide-react) and open fonts (Lato, Inter). No third-party CRM names, logos, icons, fonts or CSS are used.

## 1. Tokens (`src/styles/tokens.css`)
CSS variables on `:root` (light) and `.dark` / `[data-theme="dark"]`, exposed to Tailwind through `@theme inline` in
`src/app/globals.css`. Component classes with the `crm-` prefix (`src/styles/crm.css`, `@layer components`) carry every
size of the shell and the page templates – components reference those classes, not pixel values. The complete list
of tokens, the measurements behind them and the deviations are in [ZOHO_LAYOUT_SPEC.md](ZOHO_LAYOUT_SPEC.md); the table
below is the summary.

| Token | Light | Use (Tailwind class) |
|---|---|---|
| `--c-primary` / `--c-primary-hover` / `--c-primary-soft` | `#1565D0` / `#114FA3` / `#E8F1FE` | buttons, links, active states (`bg-primary`, `text-primary`, `bg-primary-soft`) |
| `--c-surface` / `--c-surface-alt` | `#FFFFFF` / `#F7F8FA` | cards, tables, forms; table headers (`bg-surface`, `bg-surface-alt`) |
| `--c-canvas` | `#F3F5F8` | app background (`bg-canvas`) |
| `--c-sidebar` / `-text` / `-active-bg` | `#1E2638` / `#B9C2D3` / `#2D3850` | module sidebar (`bg-sidebar`, …) |
| `--c-border` / `--c-border-strong` | `#E2E6EC` / `#CFD6DE` | hairline borders; input borders |
| `--c-text` / `--c-text-muted` | `#313949` / `#5B6472` | text (`text-text`, `text-text-muted`) |
| `--c-success` `--c-warning` `--c-danger` `--c-info` | `#22A861` `#F5A623` `#E5484D` `#0EA5E9` | status dots and fills |
| `--h-header` / `--w-sidebar` / `--w-filter` | 48 / 60 (220 pinned) / 260 px | shell geometry |
| `--h-row` / `--h-th` / `--h-control` | 40 (32 compact) / 36 / 32 px | table rows, table header, buttons and inputs |

The older names (`--primary`, `--surface`, `--row-height`, …) remain as aliases of the new tokens.

Deviations from the starting values in the brief, made for WCAG AA contrast (checked by axe in CI): primary is
`#1565D0` instead of `#1A73E8`, muted text `#5B6472` instead of `#6B7280`, and status pills use darker text shades on
their tinted fills.

- **Font**: Lato 400 / 700 (self-hosted via `@fontsource/lato`), fallback Inter Variable / system-ui. 13 px base,
  12 px table headers and labels, 20 px page titles.
- **Radius / shadow**: 4 px controls and cards, 6 px popups; a hairline shadow on cards, stronger ones on menus and
  popups.
- **Theme**: light, dark or system – stored per user (`UserPreference` key `theme`), applied as `.dark` on `<html>`.
- **Density**: standard (13 px base, the default) / comfortable (14 px – every size is in `rem`, so the whole UI
  grows) / compact (13 px with 32 px rows) – `data-density` on `<html>`, key `density`.
- **Navigation mode**: sidebar (default) or classic module tabs under the header – key `nav`.
- **Brand colours** come from the Brands master (`Brand.color`): `BrandBadge`, kanban card stripe, record header stripe.
- **Formats** (`src/lib/format.ts`): `₦ 12,500,000.00`; dates `DD/MM/YYYY` by default (user preference `dateFormat`),
  time zone Africa/Lagos.

## 2. App shell (`src/components/crm/AppShell.tsx`)
- **Module sidebar** (`ModuleRail`): dark, 60 px with an icon and a small label per module, 220 px when pinned open
  (from 1280 px). Order in `nav-config.ts`; only modules the profile can read are listed; unpinned ones sit under
  “More”. *Customize* lets each user reorder and pin (key `rail`). Bottom: Setup (administrators), Help (keyboard
  shortcuts), Customize, pin / collapse. When the user works in exactly one brand – or selected one in the switcher –
  that brand's logo is shown at the top.
- **Classic tabs** (`ClassicNav`): the same modules as tabs under the header; tabs that do not fit go into “⋯”;
  drag a tab to reorder.
- **Header** (48 px): the logos of the user's brands (`BrandLogoStrip` – uploaded logo, or a mark generated from the
  brand name), `BrandSwitcher` (brand + region – narrow, never widen), `GlobalSearch` (Ctrl/⌘+K palette over the
  scoped search API), `QuickCreateMenu` (“+”, centred popups with mandatory fields for Lead and Deal), notifications bell,
  calendar shortcut, Setup gear (administrators only), `AvatarMenu` (theme, density, date format, sign out).
- No breadcrumbs: each page has a title row with the view selector and actions.

## 3. Page templates
| Template | Building blocks | Reference page |
|---|---|---|
| List (`ModuleListPage`) | `ModuleListFrame`, `ViewSelector`, `CreateSplitButton`, `ActionsMenu`, `LayoutToggle`, `FilterPanel`, `DataTable`, `Pagination` | `src/app/(crm)/deals/page.tsx`, `leads/page.tsx` |
| Kanban (`ModuleKanban`) | `Kanban` – “Stage · count · ₦ total”, brand stripe, drag or “Move to”, collapse, *Kanban by* | `deals/DealsView.tsx`, `leads/LeadsView.tsx` |
| Record detail (`RecordDetailPage`) | `RecordHeader`, `StageProgressBar`, `DetailTabs`, `RelatedNav`, `FieldSection`, `Field` / `MaskedField`, `RelatedListCard`, `Timeline`, `RecordNav` | `deals/[id]/page.tsx`, `leads/[id]/page.tsx` |
| Form (`RecordFormPage`) | `PageTitleRow` + `FormSection`, `Required`, `StickyFormFooter` (rendered as the sticky title bar with [Cancel] [Save and New] [Save]; at the bottom on phones), `QuickCreate` popup | `leads/new/page.tsx`, `leads/[id]/edit/page.tsx` |
| Home | widget grid, per-role defaults (managers get team pipeline + pipeline by brand) | `src/app/(crm)/page.tsx` |
| Setup | `SetupLanding` (searchable category grid), `SetupLayout` (two panes) | `src/app/(crm)/admin/*` |

### List behaviour
- **Views**: system views + the user's saved views; “Save as custom view” stores filters (and field conditions).
- **Filter panel**: search, system-defined filters (touched / untouched), and field filters with operators (is, isn't,
  contains, starts with, is empty, between, in the last N days, greater / less than). Conditions travel in the URL as
  `f=field~op~value` and are validated against the module's field whitelist in `src/server/list/filters.ts`; the result
  is ANDed with the access scope, so a filter can only narrow.
- **DataTable**: sorting, sticky header, frozen first column, columns reordered by dragging a header (or in the column
  chooser) and resized by dragging a header's right edge (saved per user as `columns:<module>`), row selection → bulk bar, double-click inline edit for permitted fields, hover quick actions,
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
`Modal`, `ConfirmDialog`, `ClassicNav`, `BrandLogo`, `SetupLayout`, `SetupLanding`, `KeyboardShortcuts`, `RecordNav`; plus `DataTable`, `Kanban`,
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
- `pnpm ui:compare` – our screens next to the reference screenshots in the git-ignored `private/reference/`, with
  an overlay diff (see ZOHO_LAYOUT_SPEC.md §5).
- `pnpm e2e:visual` – screenshot baselines (list, kanban, record detail, form, home, setup × light / dark) in
  `tests/visual/*-snapshots`. Baselines are per platform; after an intentional UI change run
  `pnpm e2e:visual --update-snapshots` and commit them.

## 8. Not yet covered
Lighthouse scoring is not automated (axe covers accessibility), the layout has not been measured against reference
screenshots yet (ZOHO_LAYOUT_SPEC.md §1), mass delete / mass email / tags wait for their
modules, and the notification feed, calendar and approvals widgets are placeholders until prompts 07, 08 and 14.
