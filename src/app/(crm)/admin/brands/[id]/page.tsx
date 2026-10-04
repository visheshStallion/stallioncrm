import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addAliasAction,
  clearLogoAction,
  removeAliasAction,
  updateBrandAction,
  uploadLogoAction,
} from "@/server/modules/admin/actions";
import { adminLookups, getBrand } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";
import { BrandFields } from "../BrandFields";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const [brand, lookups] = await Promise.all([getBrand(ctx, id), adminLookups(ctx)]);
  if (!brand) notFound();
  const hasLogo = !!brand.logoMimeType;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BrandBadge brand={brand} size="lg" />
        <h2 className="text-xl font-semibold">{brand.name}</h2>
        <span className="text-sm text-muted-foreground">{brand.recordCount} record(s)</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Inactive brands accept no new records, their records become read-only and they disappear from pickers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateBrandAction} className="space-y-3">
            <input type="hidden" name="id" value={brand.id} />
            <BrandFields values={brand} users={lookups.activeUsers} codeLocked={brand.recordCount > 0} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          {hasLogo || brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- small admin preview from our own API
            <img
              src={hasLogo ? `/api/v1/brands/${brand.id}/logo?v=${brand.updatedAt.getTime()}` : brand.logoUrl!}
              alt={`${brand.code} logo`}
              className="h-12 max-w-40 rounded border border-border bg-white object-contain p-1"
            />
          ) : (
            <span className="text-sm text-muted-foreground">No logo</span>
          )}
          <ActionForm action={uploadLogoAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={brand.id} />
            <Input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="max-w-xs" />
            <SubmitButton size="sm">Upload</SubmitButton>
          </ActionForm>
          {hasLogo ? (
            <ActionForm action={clearLogoAction}>
              <input type="hidden" name="id" value={brand.id} />
              <Button size="sm" variant="ghost" type="submit">
                Remove
              </Button>
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legacy code aliases</CardTitle>
          <CardDescription>Codes from the HR rep file that map to this brand (used by the CSV user import).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border">
            {brand.aliases.map((a) => (
              <li key={a.alias} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <span className="font-mono font-semibold">{a.alias}</span>
                  {a.note ? <span className="ml-2 text-muted-foreground">{a.note}</span> : null}
                </span>
                <ActionForm action={removeAliasAction} confirm={`Remove alias ${a.alias}?`}>
                  <input type="hidden" name="alias" value={a.alias} />
                  <Button size="sm" variant="ghost" type="submit">
                    Remove
                  </Button>
                </ActionForm>
              </li>
            ))}
            {brand.aliases.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No aliases</li> : null}
          </ul>
          <ActionForm action={addAliasAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="brandId" value={brand.id} />
            <Input name="alias" placeholder="Code e.g. SNML" className="w-40 uppercase" required />
            <Input name="note" placeholder="Note (optional)" className="w-64" />
            <SubmitButton size="sm">Add alias</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
