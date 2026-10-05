# Layout spec – calibrated to the CRM the sales team used before

StallionCRM lays its screens out the way Zoho CRM does, so the sales team can switch with almost no retraining:
the same regions in the same places, the same density, the same behaviour. This document is the record of every
size and colour, where it is defined, and where we deliberately differ.

**What is ours.** All CSS is written by us (`src/styles/tokens.css`, `src/styles/crm.css`). Nothing was downloaded,
copied or de-minified from Zoho: no stylesheets, scripts, fonts, icons, images, logos or names. The font is Lato
(open, self-hosted, Inter as fallback), the icons are lucide-react, the branding is StallionCRM's.

## 1. Calibration status

| Step | Status |
|---|---|
| Starting values from the brief (§2 below) in `tokens.css` | done |
| Layout built to the brief's specification (§3) | done – see the tables below |
| `pnpm ui:compare` – our screens next to the references, with overlay diff | done, see §5 |
| **Measured against reference screenshots of our own Zoho CRM account** | **not done – no screenshots were supplied** |

Until the reference screenshots exist, every value below is the brief's approximation, not a measurement. To
finish the calibration:

1. Take the screenshots listed in §5 at **1440×900, 100% zoom, light theme** and save them in
   `private/reference/<screen>.png` (the folder is git-ignored; they are never committed, bundled or shipped).
2. Run `pnpm ui:compare` and open `private/reference/report.html`.
3. Where a region, column or control is more than ±4 px off, change the token in `src/styles/tokens.css`
   (one place – every component reads it) and note the measured value in the "Measured" column below.
4. Re-run until each screen passes visual review, then `pnpm e2e:visual --update-snapshots`.

## 2. Tokens (`src/styles/tokens.css`)

Sizes are written as `calc(<px>rem / 13)`: the number is the size in px at the 13px baseline, and everything
scales together when the user picks the comfortable density (14px).

### Typography
| Token | Value | Measured | Used for |
|---|---|---|---|
| `--font-sans` | Lato, Inter Variable, system-ui | – | everything |
| `--fs-xs` / `--fs-sm` / `--fs-base` | 11 / 12 / 13 px | – | pills, table headers and field labels, body |
| `--fs-md` / `--fs-lg` / `--fs-xl` / `--fs-title` | 14 / 16 / 18 / 20 px | – | section titles, view title, record title, page title |
| `--fw-regular` / `--fw-medium` / `--fw-bold` | 400 / 500 / 700 | – | see deviation D3 |

### Colours (light)
| Token | Value | Brief | Used for |
|---|---|---|---|
| `--c-primary` / `-hover` / `-soft` | `#1565d0` / `#114fa3` / `#e8f1fe` | `#1a73e8` / `#1662c4` / `#e8f1fe` | buttons, links, active states (D1) |
| `--c-canvas` / `--c-surface` / `--c-surface-alt` | `#f3f5f8` / `#ffffff` / `#f7f8fa` | same | page, cards, table header |
| `--c-border` / `--c-border-strong` | `#e2e6ec` / `#cfd6de` | same | hairlines, input borders |
| `--c-text` / `--c-text-muted` / `--c-text-subtle` | `#313949` / `#5b6472` / `#98a2b3` | `#313949` / `#6c7686` / `#98a2b3` | text (D2) |
| `--c-sidebar` / `-text` / `-active-bg` / `-active` | `#1e2638` / `#b9c2d3` / `#2d3850` / `#ffffff` | same | module sidebar |
| `--c-success` `--c-warning` `--c-danger` `--c-info` | `#22a861` `#f5a623` `#e5484d` `#0ea5e9` | same | status dots and fills (D4) |
| `--c-row-hover` / `--c-row-selected` | `#f5f9ff` / `#e8f1fe` | same | table rows |
| `--c-kanban-col` / `--c-toast` / `--c-overlay` | `#eef1f5` / `#2b2f36` / `rgba(16,24,40,.45)` | same | kanban columns, toasts, modal backdrop |

Dark theme values sit next to them under `.dark, [data-theme="dark"]`.

### Geometry
| Token | Value | Measured | Element |
|---|---|---|---|
| `--h-header` | 48 px | – | top header |
| `--w-sidebar` / `--w-sidebar-open` / `--h-sidebar-item` | 60 / 220 / 56 px | – | module sidebar, one item |
| `--h-tab` | 40 px | – | classic module tabs, record tabs |
| `--h-toolbar` | 52 px | – | list toolbar, modal header |
| `--w-filter` | 260 px | – | filter panel |
| `--h-th` / `--h-row` / `--h-row-compact` | 36 / 40 / 32 px | – | table header, row, compact row |
| `--h-footer` | 44 px | – | table footer (total, pager) |
| `--w-kanban-col` | 280 px (12 px gap) | – | kanban column |
| `--h-card-header` | 44 px | – | kanban column header, related list header, widget header |
| `--h-bar` | 56 px | – | record top bar, form title bar, modal footer |
| `--w-related-nav` / `--w-subnav` | 200 / 240 px | – | related-list navigation; Setup and report folder navigation |
| `--h-control` / `--h-control-sm` | 32 / 28 px | – | buttons, inputs; small buttons, split-button caret |
| `--w-search` / `--w-modal` | 360 / 560 px | – | header search, quick-create popup |
| `--h-pill` / `--h-menu-item` | 20 / 32 px | – | pills and tags; dropdown items |
| `--size-icon` / `--size-hit` / `--size-avatar` / `--size-avatar-sm` / `--size-check` | 18 / 36 / 28 / 20 / 14 px | – | header icons and their hit area, avatars, checkboxes |
| `--radius-sm` / `--radius` / `--radius-lg` / `--radius-pill` | 3 / 4 / 6 / 999 px | – | controls and cards 4 px, modals 6 px |
| `--space-1` … `--space-6` | 4 / 8 / 12 / 16 / 20 / 24 px | – | spacing scale (Tailwind's unit is the same 4 px) |
| `--shadow-card` / `--shadow-pop` / `--shadow-modal` | as in the brief | – | cards, menus, modals |
| `--focus-ring` | `0 0 0 2px rgba(21,101,208,.25)` | – | focused inputs and buttons |
| `--ease` | 150 ms ease | – | every transition (switched off by `prefers-reduced-motion`) |

## 3. Screens

### 3.1 Navigation – two modes (avatar menu → Navigation, default Sidebar)
| Element | Value | Class |
|---|---|---|
| Sidebar, collapsed | 60 px wide, dark; icon 18 px with a 10 px label below, 56 px per item | `.crm-sidebar`, `.crm-sidebar-item` |
| Sidebar, pinned open (≥ 1280 px) | 220 px; icon and label in a row, 40 px per item | `.crm-sidebar[data-open="true"]` |
| Active item | active background + 3 px left accent in the primary colour | `[aria-current="page"]` |
| Groups | 1 px rule `rgba(255,255,255,.08)` | `.crm-sidebar-group` |
| Bottom | Setup (administrators), Help (keyboard shortcuts), Customize, pin / collapse toggle | |
| Classic tabs | 40 px bar under the header; tab padding 0 14 px, 13 px medium; active = primary text + 2 px underline; tabs that do not fit go into "⋯"; drag a tab onto another to reorder | `.crm-navtabs`, `.crm-navtab` |

### 3.2 Header
48 px, white, 1 px bottom border (`.crm-header`). Left: the logos of the signed-in user's brands and the brand /
region switcher (StallionCRM additions; in classic mode our own logo comes first – in sidebar mode it sits on top of
the sidebar). Then the search box: 360 px, 4 px radius, surface-alt background, "Search" and the `Ctrl K` hint
(`.crm-search`). Right, 4 px apart: quick create (28 px primary circle), calendar, notifications (16 px count badge),
Setup gear, 28 px avatar – icons 18 px in a 36 px hit area (`.crm-icon-btn`).

### 3.3 List view
| Element | Value | Class |
|---|---|---|
| Toolbar | 52 px, white, bottom border: filter toggle · view selector (16 px bold) · Create (split button) · Actions · List / Kanban | `.crm-toolbar`, `.crm-view-title`, `.crm-segment` |
| Filter panel | 260 px, white, right border; "Filter <Module> by" 12 px bold muted; search; System Defined Filters; Filter By Fields (28 px rows, operator + value appear when ticked); sticky Apply Filter / Clear | `.crm-filter*` |
| Table area | edge to edge, no padding | `.crm-list-content`, `.crm-flush` |
| Table header | 36 px, surface-alt, 12 px bold muted, sticky | `.crm-table th` |
| Rows | 40 px (32 px compact), bottom border, hover `--c-row-hover`, selected `--c-row-selected` | `.crm-table td` |
| First data column | record name in the link colour | `.crm-col-name` |
| Checkbox column | 40 px | `.crm-col-check` |
| Row actions | appear on hover or keyboard focus | `.crm-row-actions` |
| Footer | 44 px: "Total Records N" left, pager and records-per-page (10 / 20 / 50 / 100) right | `.crm-table-footer` |
| Selection | the strip above the table becomes a primary-soft bar "N Records Selected · Clear" with the bulk buttons | `.crm-bulkbar` |

### 3.4 Kanban
Columns 280 px, 12 px gap, `--c-kanban-col`, 4 px radius, 3 px coloured top border per stage (`.crm-kanban-col`,
`--stage-color`). Column header 44 px: stage name 13 px bold, record-count pill, amount sum below in muted 12 px.
Cards: white, 4 px radius, card shadow, 12 px padding, 8 px gap; title in the link colour; muted 12 px rows; 20 px
owner avatar bottom right; 3 px brand colour stripe on the left (our addition). While dragging the card tilts 2°;
the target column shows a dashed primary outline.

### 3.5 Record detail
| Element | Value | Class |
|---|---|---|
| Top bar | 56 px, white: back arrow, 36 px initials circle, title 18 px bold, brand badge, owner chip; right: action buttons, then previous / next | `.crm-record-bar` |
| Stage bar | chevron segments 32 px: done = primary-soft with primary text, current = primary with white text, upcoming = surface-alt muted (lost = red) | `.crm-stagebar`, `.crm-stage` |
| Tabs | Overview / Timeline, 40 px, underline | `.crm-tabs`, `.crm-tab` |
| Related-list navigation | 200 px, sticky, 32 px items, hover / active = primary text on soft background; a row of tabs above the content below 1024 px | `.crm-related-nav` |
| Field sections | white cards, 4 px radius, border, 16 px padding; title 14 px bold with collapse caret | `.crm-section` |
| Fields | 2-column grid; label 40 % right-aligned muted 12 px, value 13 px | `.crm-field` |
| Related lists | card header 44 px with title, count, "+ New" | `.crm-related-card`, `.crm-card-header` |

### 3.6 Forms and popups
- **Create / edit page**: sticky 56 px title bar with the page title left and [Cancel] [Save and New] [Save] right
  (`.crm-form-bar`); sections as cards with a 2-column grid; required = red asterisk; inputs 32 px, 4 px radius,
  strong border, primary border + focus ring when focused (`.crm-input`, `.crm-select`).
- **Quick create**: centred popup 560 px – header 52 px (title, close), scrolling body, footer 56 px with
  right-aligned buttons (`.crm-modal*`). Overlay `--c-overlay`, 6 px radius, modal shadow.
- **Toasts**: bottom centre, dark `#2b2f36` with white text, 13 px, 4 px radius, gone after 4 s; a green dot marks
  success, red an error (`.crm-toast`).
- **Tooltips**: dark, 12 px, 6 × 8 px padding (`[data-tip]`).

### 3.7 Common controls
| Control | Value | Class |
|---|---|---|
| Primary button | 32 px, padding 0 16 px, 4 px radius, primary background, white 13 px bold | `.crm-btn.crm-btn-primary` |
| Secondary button | white, 1 px strong border; hover surface-alt | `.crm-btn-secondary` |
| Split button | primary + 28 px caret segment divided by 1 px `rgba(255,255,255,.35)` | `.crm-btn-split-main`, `.crm-btn-split-caret` |
| Icon button | 32 px square, 4 px radius, hover surface-alt | `.crm-btn-icon`, `.crm-btn-ghost` |
| Pills / tags | 20 px, pill radius, 11 px bold, soft fill + strong text | `.crm-pill` |
| Avatar | circle 28 px (20 px compact), initials on a generated colour | `.crm-avatar` |
| Checkbox / radio | 14 px, primary when checked | `.crm-check` |
| Dropdown menu | white, 4 px radius, pop shadow, 32 px items, hover surface-alt | `.crm-menu`, `.crm-menu-item` |
| Scrollbars | 8 px, thumb `#c7ced8`, transparent track | global |
| Empty state | our own illustration, 16 px title, 13 px muted text, primary button | `EmptyState` |

### 3.8 Home, Setup, Reports
- **Home**: greeting row; 12-column widget grid with 16 px gaps (`.crm-widget-grid`); widget cards with a 44 px header.
- **Setup**: title and a 320 px search; category cards in a 4-column grid with a 32 px icon, 14 px bold title and
  13 px links (`.crm-setup-grid`, `.crm-setup-card`); inner pages = 240 px left navigation + content (`.crm-subnav`).
- **Reports**: 240 px folder navigation left, the reports of each folder right.

## 4. Behaviour
| Behaviour | Where |
|---|---|
| Row actions appear on hover | `DataTable` (`.crm-row-actions`) |
| Double-click a cell to edit it in place (fields the user may edit) | `DataTable` |
| Drag the right edge of a column header to resize; drag a header onto another to reorder – both saved per user and module | `DataTable`, preference `columns:<module>` |
| Sticky table header and frozen first column | `DataTable` |
| Records per page 10 / 20 / 50 / 100 | `Pagination` |
| Keyboard: Ctrl/⌘ K search · `c` create · `e` edit · `/` filter · `j` / `k` next / previous | `KeyboardShortcuts` (listed under Help in the sidebar) |
| The filter panel remembers open / closed per module (in the browser) | `ModuleListFrame` |
| 150 ms transitions, switched off by `prefers-reduced-motion` | `--ease` |

### Responsive
| Width | Layout |
|---|---|
| ≥ 1280 px | full: sidebar may be pinned open, filter panel beside the table |
| 1024 – 1279 px | sidebar stays collapsed (60 px); the filter panel lies over the table as a drawer and starts closed |
| < 1024 px | related-list navigation becomes a row of tabs above the content; Setup and report folder navigation are hidden |
| < 768 px | phone layout of prompt 14: bottom navigation, form buttons in a bar at the bottom |

## 5. `pnpm ui:compare`
Renders these screens with the seed data (administrator, 1440×900, light theme) into `private/reference/ours/` and,
for each reference `private/reference/<name>.png`, writes an overlay diff (`diff/<name>.png`, pixelmatch) and a row
"reference · ours · diff" in `private/reference/report.html`. Text and data differ, so the percentage in the report
is a hint only – judge by position: regions, columns and controls within ±4 px.

| Reference file | Zoho CRM screen to capture |
|---|---|
| `home.png` | Home |
| `deals-list.png` | Deals list view with the filter panel open |
| `deals-kanban.png` | Deals kanban |
| `deal-detail-overview.png` | a Deal, Overview tab |
| `deal-detail-timeline.png` | the same Deal, Timeline tab |
| `deal-create.png` | Create Deal form |
| `quick-create.png` | quick create popup |
| `setup-home.png` | Setup home |
| `report.png` | a report |
| `dashboard.png` | a dashboard |
| `user-menu.png` | the user menu open |
| `notifications.png` | the notifications panel open |
| `global-search.png` | global search open with results |

The script needs the application's test database: it starts the same server as the end-to-end tests
(`scripts/e2e-server.ts`). It is not part of the test suites and never fails because of a difference.

## 6. Intentional deviations
| # | Brief | StallionCRM | Why |
|---|---|---|---|
| D1 | primary `#1a73e8` | `#1565d0` (hover `#114fa3`) | as link and active-state text `#1a73e8` is 3.96 : 1 on the primary-soft fill, 4.26 : 1 on a hovered row and 4.12 : 1 on the canvas; WCAG AA needs 4.5 : 1. `#1565d0` is 4.85 : 1 or better on all of them |
| D2 | muted text `#6c7686` | `#5b6472` | `#6c7686` is 4.20 : 1 on the canvas and 4.32 : 1 on table headers; `#5b6472` is 5.48 : 1 and 5.63 : 1 |
| D3 | medium weight 500 | renders as 400 | Lato ships 400 and 700 only; "medium" text therefore looks regular, bold is used where emphasis matters (record names in tables keep the link colour) |
| D4 | status colours as text | used for dots and fills; pill text is a darker shade of the same hue, counters and destructive buttons use `#c9282d` | as text on white the brief's status colours are 3.07 : 1 (success), 3.91 : 1 (danger) and 2.03 : 1 (warning); white on `#c9282d` is 5.49 : 1 |
| D5 | `--c-text-subtle` `#98a2b3` | icons, placeholders and rules only | 2.58 : 1 on white – never used for body text |
| D6 | header: logo on the left | in sidebar mode the logo is on top of the sidebar; the header starts with the brand logos and the brand / region switcher | the multi-brand cue must be the first thing a user sees; classic mode shows the logo in the header |
| D7 | form labels left of the input from 1024 px | labels above the input at every width | the forms are built from stacked label / input pairs shared with the phone layout; a left-label grid needs each form reworked |
| D8 | title bar on forms | from 768 px; below that the buttons stay in a bar at the bottom | thumb reach on phones (prompt 14) |
| D9 | picklists with a search box above 10 options | native selects | accessible and work without JavaScript; a searchable picklist is a later component |
| D10 | kanban brand stripe, brand logos, brand switcher | added | StallionCRM is multi-brand; the reference product has no such cue |
| D11 | column reorder by dragging the header | also in the column chooser | keyboard users cannot drag |
| D12 | filter panel state "remembered per module" | in the browser (`localStorage`), not in the user's server-side preferences | it is a device habit: a phone and a desktop want different defaults |

## 7. Not covered yet
- Calibration against real screenshots (§1) – the values are the brief's starting values.
- Pages outside the shared templates (some Setup and inventory pages) still carry their own pixel values in utility
  classes; they use the same colours and controls but were not rebuilt on the `crm-` classes.
- Sticky first column and column resize are not combined with row virtualisation above 500 rows in a test.
