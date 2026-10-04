import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createBrandAction } from "@/server/modules/admin/actions";
import { adminLookups, listBrands } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";
import { BrandFields } from "./BrandFields";

export const metadata = { title: "Brands" };

export default async function BrandsPage() {
  const ctx = await requireContext();
  const [brands, lookups] = await Promise.all([listBrands(ctx), adminLookups(ctx)]);
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Brand Manager</TableHead>
                <TableHead>Doc prefix</TableHead>
                <TableHead>ERP code</TableHead>
                <TableHead>Code aliases</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((b) => (
                <TableRow key={b.id} data-testid="brand-row">
                  <TableCell>
                    <Link href={`/admin/brands/${b.id}`}>
                      <BrandBadge brand={b} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/brands/${b.id}`} className="text-primary hover:underline">
                      {b.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge>{b.status}</Badge>
                  </TableCell>
                  <TableCell>{b.brandManager?.name ?? "—"}</TableCell>
                  <TableCell>{b.docPrefix ?? "—"}</TableCell>
                  <TableCell>{b.erpCompanyCode ?? "—"}</TableCell>
                  <TableCell className="text-xs">{b.aliases.map((a) => a.alias).join(", ") || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New brand</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createBrandAction} className="space-y-3">
            <BrandFields users={lookups.activeUsers} />
            <p className="text-xs text-muted-foreground">
              Creating a brand creates its brand territory and one “BRAND – Region” territory per active region.
            </p>
            <SubmitButton>Create brand</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
