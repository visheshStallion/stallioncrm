import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminLookups, listUsers } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Users" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; roleId?: string; profileId?: string; brandId?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const [users, lookups] = await Promise.all([
    listUsers(ctx, { q: sp.q, status, roleId: sp.roleId, profileId: sp.profileId, brandId: sp.brandId }),
    adminLookups(ctx),
  ]);
  const brandById = new Map(lookups.brands.map((b) => [b.id, b]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap gap-2">
          <Input name="q" defaultValue={sp.q} placeholder="Name or email" className="w-56" aria-label="Search users" />
          <Select name="status" defaultValue={status} aria-label="Status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
          <Select name="roleId" defaultValue={sp.roleId ?? ""} aria-label="Role">
            <option value="">All roles</option>
            {lookups.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select name="brandId" defaultValue={sp.brandId ?? ""} aria-label="Brand">
            <option value="">All brands</option>
            {lookups.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/users/import">Import CSV</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/users/new">New user</Link>
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Brands</TableHead>
                <TableHead>Territories</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const brandIds = [...new Set(u.memberships.map((m) => m.territory.brandId).filter((x): x is string => !!x))];
                return (
                  <TableRow key={u.id} data-testid="user-row">
                    <TableCell>
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-primary hover:underline">
                        {u.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>{u.role.name}</TableCell>
                    <TableCell>{u.profile.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {brandIds.map((id) => (
                          <BrandBadge key={id} brand={brandById.get(id)} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{u.memberships.length}</TableCell>
                    <TableCell className={u.active ? "text-emerald-700" : "text-red-600"}>{u.active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                );
              })}
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No users match.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
