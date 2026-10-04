import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminLookups, auditLog, auditLogEntities } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";
import { parseAuditFilters } from "./filters";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filters = parseAuditFilters(sp);
  const [{ rows, total }, lookups, entities] = await Promise.all([
    auditLog(ctx, { ...filters, skip: (page - 1) * PAGE, take: PAGE }),
    adminLookups(ctx),
    auditLogEntities(ctx),
  ]);
  const brandCode = new Map(lookups.brands.map((b) => [b.id, b.code]));
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2">
        <Select name="userId" defaultValue={sp.userId ?? ""} aria-label="User">
          <option value="">All users</option>
          {lookups.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select name="entity" defaultValue={sp.entity ?? ""} aria-label="Entity">
          <option value="">All entities</option>
          {entities.map((e) => (
            <option key={e}>{e}</option>
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
        <Input type="date" name="from" defaultValue={sp.from} aria-label="From" className="w-40" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="To" className="w-40" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Button asChild variant="ghost" className="ml-auto">
          <a href={`/api/v1/admin/audit/export?${qs({})}`}>Export CSV</a>
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="audit-row">
                  <TableCell className="whitespace-nowrap text-xs">{r.at.toISOString().replace("T", " ").slice(0, 19)}</TableCell>
                  <TableCell className="text-xs">{r.user?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs font-semibold">{r.action}</TableCell>
                  <TableCell className="text-xs">
                    {r.entity}
                    {r.entityId ? <span className="text-muted-foreground"> {r.entityId.slice(0, 12)}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">{r.brandId ? brandCode.get(r.brandId) ?? "?" : "—"}</TableCell>
                  <TableCell className="text-xs">{r.ip ?? "—"}</TableCell>
                  <TableCell className="max-w-md">
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">details</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {total} entr{total === 1 ? "y" : "ies"} · page {page} of {Math.max(1, Math.ceil(total / PAGE))}
        </span>
        {page > 1 ? <Link href={`/admin/audit?${qs({ page: String(page - 1) })}`} className="underline">Previous</Link> : null}
        {page * PAGE < total ? <Link href={`/admin/audit?${qs({ page: String(page + 1) })}`} className="underline">Next</Link> : null}
      </div>
    </div>
  );
}
