import type { SetupCategory } from "@/components/crm/SetupLayout";

/** Setup landing categories. `available: false` items arrive with later prompts. */
export const SETUP_CATEGORIES: SetupCategory[] = [
  {
    key: "general",
    title: "General",
    description: "Company details, currencies, business hours",
    items: [{ href: "/admin/general", label: "Company settings", available: false }],
  },
  {
    key: "users",
    title: "Users & Control",
    description: "Users, roles, profiles and data import of users",
    items: [
      { href: "/admin/users", label: "Users", available: true },
      { href: "/admin/roles", label: "Roles", available: true },
      { href: "/admin/profiles", label: "Profiles", available: true },
      { href: "/admin/users/import", label: "Import users", available: true },
    ],
  },
  {
    key: "brands",
    title: "Brands & Territories",
    description: "Brand master, regions and the visibility territories",
    items: [
      { href: "/admin/brands", label: "Brands", available: true },
      { href: "/admin/regions", label: "Regions", available: true },
      { href: "/admin/territories", label: "Territories", available: true },
    ],
  },
  {
    key: "channels",
    title: "Channels",
    description: "Web-to-lead forms, email, SMS and WhatsApp",
    items: [
      { href: "/admin/web-forms", label: "Web-to-Lead forms", available: true },
      { href: "/admin/channels/email", label: "Email & SMS", available: false },
    ],
  },
  {
    key: "customization",
    title: "Customization",
    description: "Modules, fields, layouts and pipelines",
    items: [
      { href: "/admin/pipelines", label: "Pipelines & Blueprint", available: true },
      { href: "/admin/customization", label: "Fields & layouts", available: false },
    ],
  },
  {
    key: "automation",
    title: "Automation",
    description: "Assignment rules, workflows and approvals",
    items: [
      { href: "/admin/assignment-rules/leads", label: "Lead assignment rules", available: true },
      { href: "/admin/workflows", label: "Workflow rules", available: true },
      { href: "/admin/approval-processes", label: "Approval processes", available: true },
      { href: "/admin/jobs", label: "Automation run log", available: true },
    ],
  },
  {
    key: "data",
    title: "Data Administration",
    description: "Audit log, import, export and storage",
    items: [{ href: "/admin/audit", label: "Audit log", available: true }],
  },
  {
    key: "developer",
    title: "Developer Space",
    description: "API keys and webhooks",
    items: [{ href: "/admin/api", label: "API & webhooks", available: false }],
  },
];
