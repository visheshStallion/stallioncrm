import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Administration" };

const CARDS = [
  { href: "/admin/brands", title: "Brands", text: "Brand master, legacy code aliases, logos, brand managers" },
  { href: "/admin/regions", title: "Regions", text: "Managed list of regions; adding one creates a territory per brand" },
  { href: "/admin/territories", title: "Territories", text: "Group › Brand › Brand–Region tree, managers and members" },
  { href: "/admin/roles", title: "Roles", text: "Reporting hierarchy" },
  { href: "/admin/profiles", title: "Profiles", text: "Permission grid, scope and field-level security" },
  { href: "/admin/users", title: "Users", text: "Users, territories, activation, quick-assign" },
  { href: "/admin/users/import", title: "Import users", text: "CSV import with dry-run preview" },
  { href: "/admin/audit", title: "Audit log", text: "Who changed what, with export" },
];

export default function AdminHome() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((c) => (
        <Link key={c.href} href={c.href}>
          <Card className="h-full hover:border-primary/40">
            <CardHeader>
              <CardTitle>{c.title}</CardTitle>
              <CardDescription>{c.text}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
