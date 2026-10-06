/**
 * The Setup catalogue (prompt 19): every configuration and control function, by category – the single source for
 * the Setup home, its search, the left navigation, the tier check of each page (`setupPermission`) and
 * docs/SETUP_CATALOGUE.md (generated from this file: `pnpm setup:catalogue`).
 *
 * Tiers
 *   SA           Super Admin only
 *   ADMIN        Administrator profile (and every Super Admin)
 *   BRAND_ADMIN  delegated Brand Admin, limited to the own brand(s) – only where `brandAdminReady` is set
 *   ALL          every signed-in user
 *
 * Status
 *   DONE     working
 *   PARTIAL  the core works; `statusNote` says what is missing
 *   PLANNED  scaffolded: the page explains what will come ("Coming soon")
 *
 * Pure data: no imports from the server, so tests and the documentation script can read it.
 */

export type SetupTier = "SA" | "ADMIN" | "BRAND_ADMIN" | "ALL";
export type SetupPriority = "P1" | "P2" | "P3";
export type SetupStatus = "DONE" | "PARTIAL" | "PLANNED";

export interface SetupEntry {
  key: string;
  category: string;
  label: string;
  description: string;
  priority: SetupPriority;
  /** Who may open it. A Super Admin always may. */
  tiers: SetupTier[];
  status: SetupStatus;
  /** What is missing (PARTIAL) or why it waits (PLANNED). */
  statusNote?: string;
  /** Page of the function. Defaults to /setup/<key> (the scaffold page when the function has no page of its own). */
  href?: string;
  /**
   * The page lives outside Setup and is guarded by its own module permission (e.g. Import, Templates): Setup links
   * to it, the tier does not decide who may open it.
   */
  external?: boolean;
  /** A Brand Admin can really use the page today, limited to the own brand(s). */
  brandAdminReady?: boolean;
  /** May be granted to a non-administrator profile through "Setup permissions" (never security or tier functions). */
  delegable?: boolean;
  /** Prompt that built the reused part. */
  reuse?: string;
}

export interface SetupCategoryDef {
  key: string;
  title: string;
  description: string;
}

export const SETUP_CATEGORY_DEFS: SetupCategoryDef[] = [
  { key: "general", title: "General", description: "Personal settings, users, company settings, calendar booking" },
  { key: "security", title: "Security Control", description: "Profiles, roles and sharing, compliance, sign-in policies, login history, audit log" },
  { key: "channels", title: "Channels", description: "Email, telephony, business messaging, SMS, web forms, social, chat, portals" },
  { key: "customization", title: "Customization", description: "Modules and fields, pipelines, wizards, canvas, home page, templates" },
  { key: "automation", title: "Automation", description: "Workflow rules, actions, assignment, scoring, cadences" },
  { key: "process", title: "Process Management", description: "Blueprint, connected workflows and approval processes" },
  { key: "experience", title: "Experience Center", description: "Signals and the customer journey command centre" },
  { key: "data", title: "Data Administration", description: "Import, export, backup, storage, recycle bin, copy customization" },
  { key: "marketplace", title: "Marketplace", description: "Integrations with other systems and extensions" },
  { key: "developer", title: "Developer Hub", description: "APIs, connections, widgets, data model, queries, scripts and functions" },
  { key: "ai", title: "AI Assistant", description: "Predictions, suggestions and assistance from the data in the CRM" },
  { key: "cpq", title: "CPQ", description: "Product configuration and price rules for quotations" },
  { key: "users", title: "Users & Control", description: "Groups, profile comparison and territories" },
  { key: "brands", title: "Brands & Territories", description: "Brand master, regions, territories, brand admins, access review" },
  { key: "health", title: "Usage & Health", description: "Usage statistics and system health" },
];

const e = (entry: SetupEntry): SetupEntry => entry;

export const SETUP_CATALOGUE: SetupEntry[] = [
  // ───────────────────────────── 2.1 General ─────────────────────────────
  e({ key: "personal-settings", category: "general", label: "Personal Settings", description: "Theme, density, navigation mode, date format, notification preferences, sign-in security", priority: "P1", tiers: ["ALL"], status: "PARTIAL", statusNote: "Photo, language, time zone, number format and e-mail signature are not editable yet", href: "/setup/personal" }),
  e({ key: "company-details", category: "general", label: "Company Settings", description: "Group name, address, primary contact, default time zone, locale and date format", priority: "P1", tiers: ["SA"], status: "PARTIAL", statusNote: "The group logo upload is missing; brand logos are in Brands", href: "/setup/company" }),
  e({ key: "fiscal-year", category: "general", label: "Fiscal Year", description: "Start month of the financial year and its quarters", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Stored and shown; forecasts and reports still use calendar quarters. No override per brand", href: "/setup/fiscal-year", delegable: true }),
  e({ key: "business-hours", category: "general", label: "Business Hours & Holidays", description: "Working days and hours, public holidays; used by SLA and escalations", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "One calendar for the group, not per region", href: "/cases/sla", external: true, reuse: "11" }),
  e({ key: "currencies", category: "general", label: "Currencies", description: "Home currency NGN, extra currencies with manual exchange rates, rounding", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Rates are entered by hand (no daily feed) and are a reference list: documents keep the currency chosen on them", href: "/setup/currencies", delegable: true }),
  e({ key: "licences", category: "general", label: "Subscription & Licences", description: "Licence count by type, assigned and free, renewal date, add-ons", priority: "P2", tiers: ["SA"], status: "PLANNED" }),
  e({ key: "appointments", category: "general", label: "Calendar Booking", description: "Public booking pages for test drives and service per brand and showroom", priority: "P2", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PLANNED" }),

  // ───────────────────────────── 2.2 Users & Control ─────────────────────────────
  e({ key: "users", category: "general", label: "Users", description: "Create, activate and deactivate users, reassign records on exit, CSV import", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Invitation e-mail, licence assignment and login-as (impersonation) are not built", href: "/admin/users", reuse: "01" }),
  e({ key: "groups", category: "users", label: "Groups", description: "Named groups of users, roles and territories for sharing, assignment and notifications", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "roles", category: "security", label: "Roles and Sharing", description: "Reporting hierarchy tree", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "No \"peers share data\" switch: visibility follows territories, not the role tree", href: "/admin/roles", reuse: "01" }),
  e({ key: "profiles", category: "security", label: "Profiles", description: "Module permissions, field-level security, clone a profile", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/profiles", reuse: "01" }),
  e({ key: "profiles-compare", category: "users", label: "Compare Profiles", description: "Two profiles side by side: every permission that differs", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/profiles-compare" }),
  e({ key: "territory-management", category: "users", label: "Territory Management", description: "Territory tree, members, managers, move records", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/territories", reuse: "01" }),
  e({ key: "data-sharing", category: "security", label: "Data Sharing Settings", description: "Default access per module and sharing rules, with an impact preview", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Rules are validated (never across brands), previewed and stored, but the access engine does not apply them yet: records stay visible by territory and ownership only", href: "/setup/data-sharing" }),
  e({ key: "teamspaces", category: "customization", label: "Teamspace", description: "Module groupings and navigation per team", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),

  // ───────────────────────────── 2.3 Security Control ─────────────────────────────
  e({ key: "password-policy", category: "security", label: "Security Policies", description: "Length, complexity, expiry, history, lockout attempts", priority: "P1", tiers: ["SA"], status: "DONE", href: "/setup/password-policy" }),
  e({ key: "mfa", category: "security", label: "Multi-factor authentication", description: "Require two-step sign-in (authenticator app) by profile", priority: "P1", tiers: ["SA"], status: "PARTIAL", statusNote: "No trusted devices", href: "/setup/mfa" }),
  e({ key: "sso", category: "security", label: "Single Sign-On (SAML)", description: "Microsoft Entra ID / SAML / OIDC, just-in-time provisioning, enforce SSO for staff", priority: "P2", tiers: ["SA"], status: "PLANNED", statusNote: "Microsoft Entra ID sign-in exists and is configured with environment variables (docs/SECURITY.md); there is no Setup page" }),
  e({ key: "allowed-ips", category: "security", label: "Allowed IPs / Network restrictions", description: "IP ranges per profile", priority: "P2", tiers: ["SA"], status: "PLANNED" }),
  e({ key: "session-settings", category: "security", label: "Session settings", description: "Maximum session length, sign out all sessions of a user", priority: "P1", tiers: ["SA"], status: "PARTIAL", statusNote: "No limit on concurrent sessions and no idle timeout", href: "/setup/sessions" }),
  e({ key: "record-locking", category: "security", label: "Record Locking", description: "Lock records on a stage or approval; who can unlock", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Records are already locked while an approval is pending (prompt 08); there are no configurable locking rules" }),
  e({ key: "field-encryption", category: "security", label: "Field encryption", description: "Encrypt sensitive fields at rest (KYC, licence number, bank details)", priority: "P2", tiers: ["SA"], status: "PLANNED" }),
  e({ key: "compliance", category: "security", label: "Compliance Settings", description: "Consent tracking, data subject requests, retention policies, privacy notice", priority: "P2", tiers: ["SA"], status: "PLANNED", statusNote: "Marketing consent per brand is tracked on contacts (prompt 03); data subject requests and retention are not built" }),
  e({ key: "support-access", category: "security", label: "Support Access", description: "Time-boxed vendor or developer access with audit", priority: "P3", tiers: ["SA"], status: "PLANNED" }),
  e({ key: "login-history", category: "security", label: "Login History", description: "Every sign-in, failed attempt and sign-out with address and device", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/login-history" }),

  // ───────────────────────────── 2.4 Channels ─────────────────────────────
  e({ key: "email-config", category: "channels", label: "Email", description: "Sender identity per brand; provider credentials", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Sender identity is on each brand; provider credentials are environment variables. No SPF/DKIM status, sharing rules or BCC dropbox. Administrators only", href: "/admin/brands", reuse: "10" }),
  e({ key: "email-deliverability", category: "channels", label: "Email deliverability & compliance", description: "Bounce and unsubscribe handling, suppression lists per brand", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Bounces and unsubscribes are already recorded per brand (prompt 10); there is no management page" }),
  e({ key: "sms", category: "channels", label: "Notification SMS", description: "Provider settings, sender ID per brand, SMS templates", priority: "P2", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Sender ID is on each brand, templates under Templates; provider credentials are environment variables. Administrators only", href: "/admin/brands", reuse: "10" }),
  e({ key: "whatsapp", category: "channels", label: "Business Messaging", description: "WhatsApp Business numbers per brand, template approval status, inbound routing", priority: "P2", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Number per brand and templates exist; no approval status sync. Administrators only", href: "/admin/brands", reuse: "10" }),
  e({ key: "telephony", category: "channels", label: "Telephony", description: "Click-to-call provider, call logging, recording policy", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "social", category: "channels", label: "Social", description: "Facebook / Instagram lead ads per brand page", priority: "P3", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PLANNED" }),
  e({ key: "web-forms", category: "channels", label: "Webforms", description: "Web-to-lead and web-to-case forms per brand, embed code, spam protection", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "No form builder or auto-response; one form per brand. Administrators only", href: "/admin/web-forms", reuse: "02 / 11" }),
  e({ key: "portals", category: "channels", label: "Portals", description: "Customer portal (order status, documents)", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "notification-channels", category: "channels", label: "Notification channels", description: "In-app, e-mail digest and web push", priority: "P2", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Each user sets their own preferences; there are no organisation defaults", href: "/notifications", external: true, reuse: "14" }),

  // ───────────────────────────── 2.5 Customization ─────────────────────────────
  e({ key: "document-dependencies", category: "customization", label: "Dependencies", description: "Which links quotes, sales orders and invoices need per brand: account, contact, deal, product, quote before order, order before invoice, stock link for vehicles", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", href: "/setup/document-dependencies", brandAdminReady: true }),
  e({ key: "modules-fields", category: "customization", label: "Modules and Fields", description: "Custom fields, field types, mandatory and unique, picklist values", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "No custom modules, module renaming, lookup filters, picklist dependencies or global picklists", href: "/admin/customization", reuse: "12" }),
  e({ key: "layouts", category: "customization", label: "Layouts & Layout Rules", description: "Layouts per module and brand, section order, show / hide / require rules", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Administrators only", href: "/admin/customization", reuse: "12" }),
  e({ key: "validation-rules", category: "customization", label: "Validation Rules", description: "Refuse a save when a formula is true, with your own error message", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/validation-rules", delegable: true }),
  e({ key: "lead-conversion-mapping", category: "customization", label: "Lead conversion mapping", description: "Which lead fields go to the account, contact and deal", priority: "P1", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Conversion works with a fixed mapping (prompt 02); it cannot be changed in Setup" }),
  e({ key: "document-mapping", category: "customization", label: "Quote → SO → Invoice mapping", description: "Field mapping between documents", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Documents are converted with a fixed mapping (prompt 06)" }),
  e({ key: "pipelines", category: "customization", label: "Pipelines", description: "Pipelines per brand, stages, probabilities", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Administrators only", href: "/admin/pipelines", reuse: "04" }),
  e({ key: "list-kanban-settings", category: "customization", label: "List view & Kanban settings", description: "Default views, columns and kanban field per module", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Each user saves their own views and columns; there are no organisation defaults" }),
  e({ key: "templates", category: "customization", label: "E-mail, SMS & WhatsApp templates", description: "Message templates per brand; rich e-mail templates with blocks, starter gallery and version history", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", statusNote: "Open to brand managers through the Campaigns permission", href: "/campaigns/templates", external: true, reuse: "10 / 20" }),
  e({ key: "print-templates", category: "customization", label: "Print templates", description: "Design the printouts of every module from blocks, on the brand letterhead, with preview, versions and defaults", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", href: "/setup/print-templates", brandAdminReady: true }),
  e({ key: "document-templates", category: "customization", label: "Document templates", description: "Rich page editor for company-formatted invoices, sales orders, quotations, offer letters and receipts: letterhead, smart blocks, approval, versions, stored copies", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", statusNote: "Everyone reaches their personal templates from Personal Settings and the e-mail composer; shared ones are published by the Brand Admin or an administrator", href: "/templates/documents", external: true, brandAdminReady: true }),
  e({ key: "templates-hub", category: "customization", label: "Templates", description: "One place for e-mail, document / print, record, SMS and WhatsApp templates of every module: views, folders, favourites, new template by module", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", statusNote: "Every user reaches the hub under Templates; what they see and may change follows each template type's rules", href: "/setup/templates", brandAdminReady: true }),
  e({ key: "record-template-policy", category: "customization", label: "Record template policy", description: "Modules whose records must be created from a record template", priority: "P2", tiers: ["ADMIN"], status: "DONE", href: "/setup/record-template-policy" }),
  e({ key: "print-policy", category: "customization", label: "Print policy", description: "Watermark on the list printouts of chosen profiles", priority: "P2", tiers: ["ADMIN"], status: "DONE", href: "/setup/print-policy" }),
  e({ key: "canvas", category: "customization", label: "Canvas", description: "Drag-and-drop record detail designer", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "wizards", category: "customization", label: "Wizards", description: "Multi-step guided create forms", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "home-customization", category: "customization", label: "Customize Home page", description: "Role-based home layouts and widgets", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "The home page already differs by role (prompt 09); it cannot be designed in Setup" }),
  e({ key: "tags", category: "customization", label: "Tags", description: "Tag management per module", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "translations", category: "customization", label: "Translations & labels", description: "Rename labels, multilingual interface", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "search-config", category: "customization", label: "Search configuration", description: "Searchable fields and result columns per module", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Search covers a fixed set of fields (prompt 14)" }),

  // ───────────────────────────── 2.6 Automation ─────────────────────────────
  e({ key: "workflow-rules", category: "automation", label: "Workflow Rules", description: "Trigger, criteria, instant and scheduled actions", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Administrators only", href: "/admin/workflows", reuse: "08" }),
  e({ key: "actions-library", category: "automation", label: "Actions", description: "Reusable e-mail notifications, tasks, field updates and webhooks", priority: "P1", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Actions are defined inside each workflow rule (prompt 08); they are not reusable across rules" }),
  e({ key: "assignment-rules", category: "automation", label: "Assignment", description: "Criteria → user, round-robin or territory", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Leads only (cases are routed by the SLA settings). Administrators only", href: "/admin/assignment-rules/leads", reuse: "02" }),
  e({ key: "escalation-rules", category: "automation", label: "Escalation Rules", description: "Case SLA escalation", priority: "P2", tiers: ["ADMIN"], status: "DONE", href: "/cases/sla", external: true, reuse: "11" }),
  e({ key: "scoring-rules", category: "automation", label: "Scoring Rules", description: "Lead and contact scoring by field values and activity", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "cadences", category: "automation", label: "Cadences", description: "Timed follow-up sequences", priority: "P3", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PLANNED" }),
  e({ key: "schedules", category: "automation", label: "Schedules", description: "Scheduled custom functions", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Workflow rules can run on a schedule (prompt 08); there are no free-standing scheduled functions" }),
  e({ key: "workflow-logs", category: "automation", label: "Workflow usage & logs", description: "Executions, failures, retry", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/jobs", reuse: "08" }),

  // ───────────────────────────── 2.7 Process Management ─────────────────────────────
  e({ key: "blueprint", category: "process", label: "Blueprint", description: "Stage transitions with required fields per transition", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Edited as a list per pipeline; no visual designer, no owners or SLAs per transition", href: "/admin/pipelines", reuse: "04" }),
  e({ key: "approval-processes", category: "process", label: "Approval Processes", description: "Multi-step approvals (discount, brand change, stock adjustments)", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/approval-processes", reuse: "08" }),
  e({ key: "review-process", category: "process", label: "Review Process", description: "Review new or edited records before they go live", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "journeys", category: "experience", label: "Command Center", description: "Cross-module customer journeys", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),

  // ───────────────────────────── 2.8 Data Administration ─────────────────────────────
  e({ key: "import", category: "data", label: "Import", description: "Wizard, saved mappings, history, undo", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", href: "/imports", external: true, reuse: "12" }),
  e({ key: "export", category: "data", label: "Export", description: "Module export, export jobs, audit", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/exports", external: true, reuse: "12" }),
  e({ key: "data-backup", category: "data", label: "Data Backup", description: "Encrypted full backup to download", priority: "P1", tiers: ["SA"], status: "PARTIAL", statusNote: "On demand only: no schedule, no retention, no restore from Setup (restore is a database operation, docs/GO_LIVE_CHECKLIST.md)", href: "/setup/backup" }),
  e({ key: "recycle-bin", category: "data", label: "Recycle Bin", description: "Deleted records: restore, or purge for good (Super Admin, two-person approval)", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/recycle-bin" }),
  e({ key: "duplicate-management", category: "data", label: "Duplicate management", description: "Find and merge duplicate customers", priority: "P2", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "Customers only; no configurable duplicate rules or scheduled scans", href: "/accounts/duplicates", external: true, reuse: "03" }),
  e({ key: "storage", category: "data", label: "Storage", description: "File storage usage by module and brand, limits", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "audit-log", category: "security", label: "Audit Log", description: "Every data change; filter and export", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/audit", reuse: "01" }),
  e({ key: "setup-audit-trail", category: "data", label: "Setup Audit Trail", description: "Every setting change with before and after, who, when and from where; revert where safe", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/audit-trail" }),
  e({ key: "remove-sample-data", category: "data", label: "Remove sample data", description: "Purge demo records before go-live (two-person approval)", priority: "P1", tiers: ["SA"], status: "DONE", href: "/setup/sample-data" }),
  e({ key: "mass-operations", category: "data", label: "Mass delete / mass transfer", description: "Transfer ownership in bulk; delete by criteria (Super Admin, two-person approval)", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/mass-operations" }),
  e({ key: "setup-approvals", category: "data", label: "Two-person approvals", description: "Destructive operations waiting for a second Super Admin", priority: "P1", tiers: ["SA"], status: "DONE", href: "/setup/approvals" }),

  // ───────────────────────────── 2.9 Marketplace & Integrations ─────────────────────────────
  e({ key: "integrations", category: "marketplace", label: "All", description: "ERP, payments, WhatsApp, SMS: status and configuration", priority: "P2", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "ERP and payment adapters are configured with environment variables and shown here; no Microsoft 365 / Google Workspace connectors, no per-integration test button", href: "/admin/api", reuse: "13" }),
  e({ key: "extensions", category: "marketplace", label: "Extension Builder", description: "Install internal extensions (feature flags)", priority: "P3", tiers: ["SA"], status: "PLANNED" }),

  // ───────────────────────────── 2.10 Developer Space ─────────────────────────────
  e({ key: "api-tokens", category: "developer", label: "APIs and SDKs", description: "OAuth clients, integration users, personal tokens", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "No usage and limit dashboard; organisation-wide clients are not reserved for Super Admins", href: "/admin/api", reuse: "13" }),
  e({ key: "webhooks", category: "developer", label: "Webhooks", description: "Outbound webhooks with brand filters and delivery log", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/webhooks", reuse: "13" }),
  e({ key: "connections", category: "developer", label: "Connections", description: "Stored credentials for external services", priority: "P2", tiers: ["SA"], status: "PLANNED", statusNote: "Credentials live in environment variables, never in the database" }),
  e({ key: "functions", category: "developer", label: "Functions", description: "Server-side custom functions callable from workflows and buttons", priority: "P3", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "custom-buttons", category: "developer", label: "Custom buttons & links", description: "Buttons on list and detail pages", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "variables", category: "developer", label: "Variables", description: "Organisation-level constants for rules and functions", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "config-as-code", category: "data", label: "Copy Customization", description: "The configuration as versioned JSON: export, validate, import", priority: "P2", tiers: ["SA"], status: "PARTIAL", statusNote: "Covers settings, roles, profiles, validation rules, custom fields, layouts and pipelines; not workflow rules, approval processes or templates", href: "/setup/config" }),
  e({ key: "sandbox", category: "developer", label: "Sandbox", description: "Copy the configuration to a sandbox; deploy changes to production with diff and rollback", priority: "P2", tiers: ["SA"], status: "PLANNED", statusNote: "Use Configuration export / import between two installations until then" }),

  // ───────────────────────────── 2.11 Brands & Territories ─────────────────────────────
  e({ key: "brands", category: "brands", label: "Brands master", description: "Brands, legal entity, ERP company, prefix, colour, logo, status, brand manager", priority: "P1", tiers: ["ADMIN"], status: "DONE", statusNote: "Creating a brand and making one inactive is for Super Admins", href: "/admin/brands", reuse: "01" }),
  e({ key: "brand-aliases", category: "brands", label: "Legacy code aliases", description: "Old rep-file codes mapped to brands", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/brands", reuse: "01" }),
  e({ key: "regions", category: "brands", label: "Regions", description: "Regions list; each region gets a territory under every brand", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/admin/regions", reuse: "01" }),
  e({ key: "brand-members", category: "brands", label: "Brand team (territory membership)", description: "Who works in which territory of a brand, and who manages it", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "DONE", href: "/setup/brand-members", brandAdminReady: true }),
  e({ key: "letterhead", category: "brands", label: "Letterhead", description: "Logo, legal entity, RC and VAT numbers, address, contact, bank details, colour and footer printed on every document of the brand", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "No separate watermark image; the group letterhead uses Company Details and has no logo", href: "/setup/letterhead", brandAdminReady: true }),
  e({ key: "brand-thresholds", category: "brands", label: "Brand thresholds", description: "Discount approval thresholds per brand", priority: "P1", tiers: ["ADMIN", "BRAND_ADMIN"], status: "PARTIAL", statusNote: "Reservation expiry is in Inventory settings; the stale-deal period is fixed at 14 days", href: "/setup/brand-thresholds", brandAdminReady: true }),
  e({ key: "admin-tiers", category: "brands", label: "Administrators & Brand Admins", description: "Super Admins, delegated Brand Admins, and Setup permissions of other profiles", priority: "P2", tiers: ["SA"], status: "DONE", href: "/setup/admin-tiers" }),
  e({ key: "access-review", category: "brands", label: "Access review", description: "Who can see what: users × brands × regions", priority: "P1", tiers: ["ADMIN"], status: "PARTIAL", statusNote: "No recorded quarterly sign-off", href: "/admin/access-review", reuse: "15" }),

  // ───────────────────────────── 2.12 Usage & Health ─────────────────────────────
  e({ key: "usage-statistics", category: "health", label: "Usage statistics", description: "Active users, logins, records created per brand and module, API calls", priority: "P2", tiers: ["ADMIN"], status: "PLANNED" }),
  e({ key: "system-health", category: "health", label: "System health", description: "Job queue, failed jobs, webhook failures, undelivered messages", priority: "P1", tiers: ["ADMIN"], status: "DONE", href: "/setup/health", delegable: true }),
  e({ key: "feature-toggles", category: "health", label: "Release notes / feature toggles", description: "Enable new features per organisation or brand", priority: "P3", tiers: ["SA"], status: "PLANNED" }),
  // ── standard CRM Setup functions not built yet (listed so that Setup is complete; each page says what exists instead)
  e({ key: "motivator", category: "general", label: "Motivator", description: "Sales contests, targets and leaderboards for the sales teams", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Forecasts and dashboards show targets and results; there are no contests or badges" }),
  e({ key: "trusted-domain", category: "security", label: "Trusted Domain", description: "Web addresses that may embed or call the CRM", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. The content security policy allows this application's own address only" }),
  e({ key: "ad-sync", category: "security", label: "Active Directory Sync", description: "Create and deactivate users from the company directory", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Users are created by an administrator or by import; sign-in with Microsoft Entra ID is prepared under Single Sign-On" }),
  e({ key: "chat", category: "channels", label: "Chat", description: "Live chat with website visitors, routed to the brand's team", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Website enquiries arrive through web forms and WhatsApp" }),
  e({ key: "kiosk", category: "customization", label: "Kiosk Studio", description: "Guided screens for a fixed task, for example showroom reception", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. The quick create forms and the mobile quick screen cover the common tasks" }),
  e({ key: "connected-workflow", category: "process", label: "Connected Workflow", description: "One process across several modules and teams, with hand-overs", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Workflow rules and Blueprint work per module" }),
  e({ key: "signals", category: "experience", label: "Signals", description: "Live notices when a customer opens an e-mail, replies or visits", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "The notification centre tells users about replies, approvals and assignments; opens and visits are not tracked" }),
  e({ key: "marketplace-google", category: "marketplace", label: "Google", description: "Calendar, contacts and mail of Google Workspace", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built" }),
  e({ key: "marketplace-microsoft", category: "marketplace", label: "Microsoft", description: "Calendar, contacts and mail of Microsoft 365, Teams", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "E-mail can be sent through Microsoft Graph (environment setting); calendar and contact sync are not built" }),
  e({ key: "marketplace-facebook", category: "marketplace", label: "Facebook", description: "Lead ads and page messages as leads", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Leads with the source Facebook are entered or imported" }),
  e({ key: "marketplace-linkedin", category: "marketplace", label: "LinkedIn", description: "Lead forms and company pages", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built" }),
  e({ key: "marketplace-tiktok", category: "marketplace", label: "TikTok", description: "Lead forms of TikTok campaigns", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built" }),
  e({ key: "mcp-agents", category: "developer", label: "MCP for AI Agents", description: "Let AI agents read and act in the CRM with a user's brand-scoped access", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. The REST API with brand-scoped tokens is what an agent can use today" }),
  e({ key: "widgets", category: "developer", label: "Widgets", description: "Own panels embedded in record pages and the home page", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built" }),
  e({ key: "data-model", category: "developer", label: "Data Model", description: "Modules, fields and relations as a diagram", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Modules and Fields lists every module with its fields" }),
  e({ key: "queries", category: "developer", label: "Queries", description: "Saved data queries for widgets and scripts", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Reports and the REST API read data, always brand-scoped" }),
  e({ key: "client-script", category: "developer", label: "Client Script", description: "Scripts that run in the browser on record pages", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built – and not planned without a review of the security impact" }),
  e({ key: "ai-predictions", category: "ai", label: "Predictions and suggestions", description: "Deal and lead scoring, best time to contact, next best action", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. No customer data leaves the CRM for an AI service" }),
  e({ key: "ai-assistant", category: "ai", label: "Assistant", description: "Ask questions about your records in plain language", priority: "P3", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built" }),
  e({ key: "product-configurator", category: "cpq", label: "Product Configurator", description: "Rules for which products and accessories go together on a quotation", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Not built. Record templates for quotations pre-fill line items" }),
  e({ key: "price-rules", category: "cpq", label: "Price Rules", description: "Automatic prices and discounts by quantity, customer or campaign", priority: "P2", tiers: ["ADMIN"], status: "PLANNED", statusNote: "Price books and discount thresholds with approval exist per brand; there are no automatic price rules" }),
];

export const hrefOf = (entry: SetupEntry) => entry.href ?? `/setup/${entry.key}`;

export function findEntry(key: string): SetupEntry | undefined {
  return SETUP_CATALOGUE.find((x) => x.key === key);
}

/**
 * The standard arrangement of a CRM's Setup: these functions come first in their category, in this order. Everything
 * else of the category (functions specific to this CRM) follows.
 */
export const SETUP_STANDARD_ORDER: Record<string, string[]> = {
  general: ["personal-settings", "users", "company-details", "appointments", "motivator"],
  security: ["profiles", "roles", "compliance", "trusted-domain", "support-access", "sso", "password-policy", "ad-sync", "login-history", "audit-log"],
  channels: ["email-config", "telephony", "whatsapp", "sms", "web-forms", "social", "chat", "portals"],
  customization: ["modules-fields", "document-dependencies", "pipelines", "wizards", "kiosk", "canvas", "home-customization", "templates-hub", "teamspaces"],
  automation: ["workflow-rules", "actions-library", "assignment-rules", "scoring-rules", "cadences"],
  process: ["blueprint", "connected-workflow"],
  experience: ["signals", "journeys"],
  data: ["import", "export", "data-backup", "storage", "recycle-bin", "config-as-code"],
  marketplace: ["integrations", "marketplace-google", "marketplace-microsoft", "extensions", "marketplace-facebook", "marketplace-linkedin", "marketplace-tiktok"],
  developer: ["mcp-agents", "api-tokens", "connections", "widgets", "data-model", "queries", "client-script", "functions"],
};

/** Position of a function in its card: standard functions in their order, then the rest as listed in the catalogue. */
export function standardRank(entry: Pick<SetupEntry, "key" | "category">): number {
  const i = (SETUP_STANDARD_ORDER[entry.category] ?? []).indexOf(entry.key);
  return i < 0 ? 1000 : i;
}
