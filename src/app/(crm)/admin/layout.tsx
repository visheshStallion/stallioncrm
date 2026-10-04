import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/request";

const SECTIONS = [
  { href: "/admin/brands", label: "Brands" },
  { href: "/admin/regions", label: "Regions" },
  { href: "/admin/territories", label: "Territories" },
  { href: "/admin/roles", label: "Roles" },
  { href: "/admin/profiles", label: "Profiles" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/users/import", label: "Import users" },
  { href: "/admin/assignment-rules/leads", label: "Lead assignment" },
  { href: "/admin/web-forms", label: "Web forms" },
  { href: "/admin/audit", label: "Audit log" },
];

/** Administrator profile only; everyone else gets 404 (the admin area is not revealed). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (!ctx.isAdmin) notFound();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Administration</h1>
        <nav className="mt-3 flex flex-wrap gap-1 border-b border-border text-sm" aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="rounded-t-md px-3 py-1.5 hover:bg-muted">
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
