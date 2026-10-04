import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { RegionBadge } from "@/components/RegionBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { changeOwnerAction, updateLeadAction } from "@/server/modules/leads/actions";
import { getLead, leadFormLookups, leadTimeline } from "@/server/modules/leads/queries";
import { SOURCE_LABELS, STATUS_LABELS } from "@/server/modules/leads/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { LeadFormFields } from "../LeadFormFields";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "read")) forbidden();
  // Missing and out-of-scope leads are both 404 – existence is never revealed.
  const lead = await getLead(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, lookups, timeline] = await Promise.all([getDirectory(ctx), leadFormLookups(ctx), leadTimeline(ctx, id)]);
  const brand = dir.brands.find((b) => b.id === lead.brandId);
  const region = dir.regions.find((r) => r.id === lead.regionId);
  const converted = lead.status === "CONVERTED";
  const canEdit = !converted && can(ctx, "leads", "edit", lead);
  const canConvert = !converted && canEdit && can(ctx, "deals", "create", lead);
  // Edit form needs the lead's own brand/region even if the user could not create there.
  const formLookups = {
    ...lookups,
    brands: lookups.brands.some((b) => b.id === lead.brandId) ? lookups.brands : [...lookups.brands, { id: lead.brandId, code: brand?.code ?? "?", name: brand?.name ?? "" }],
    regions: lookups.regions.some((r) => r.id === lead.regionId) ? lookups.regions : [...lookups.regions, { id: lead.regionId, name: region?.name ?? "?" }],
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" data-testid="record-header">
        <BrandBadge brand={brand} size="lg" />
        <h1 className="text-2xl font-semibold">{lead.name}</h1>
        <RegionBadge region={region} />
        <Badge>{STATUS_LABELS[lead.status as keyof typeof STATUS_LABELS]}</Badge>
        {lead.rating ? <Badge>{lead.rating}</Badge> : null}
        <div className="ml-auto flex gap-2">
          {canConvert ? (
            <Button asChild>
              <Link href={`/leads/${lead.id}/convert`}>Convert</Link>
            </Button>
          ) : null}
          {converted && lead.convertedDealId ? (
            <Button asChild variant="outline">
              <Link href={`/deals/${lead.convertedDealId}`}>Open deal</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Owner {lead.ownerName} · {SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}
        {lead.sourceDetail ? ` (${lead.sourceDetail})` : ""} · created {formatDate(lead.createdAt)}
        {lead.utm ? ` · ${Object.entries(lead.utm).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}
      </p>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{canEdit ? "Edit lead" : "Lead details"}</CardTitle>
              {converted ? <CardDescription>Converted leads are read-only.</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <ActionForm action={updateLeadAction} className="space-y-4">
                <input type="hidden" name="id" value={lead.id} />
                <fieldset disabled={!canEdit} className="space-y-4">
                  <LeadFormFields lookups={formLookups} values={lead} mode="edit" />
                  {canEdit ? <SubmitButton>Save</SubmitButton> : null}
                </fieldset>
              </ActionForm>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Owner</CardTitle>
                <CardDescription>The new owner must work in this lead&apos;s brand and region.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm action={changeOwnerAction} className="flex gap-2">
                  <input type="hidden" name="id" value={lead.id} />
                  <Select name="ownerId" defaultValue={lead.ownerId} aria-label="New owner" className="flex-1">
                    {lookups.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="outline">
                    Change
                  </SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Field history. Activities and emails appear here with prompts 07 / 10.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm" data-testid="timeline">
                {timeline.map((t) => (
                  <li key={t.id} className="border-l-2 border-border pl-3">
                    <div className="text-xs text-muted-foreground">
                      {t.at.replace("T", " ").slice(0, 16)} · {t.user}
                    </div>
                    <div className="font-medium">{t.action === "CREATE" ? "Lead created" : t.action === "UPDATE" ? "Updated" : t.action}</div>
                    {t.changes.map((c) => (
                      <div key={c.field} className="text-xs">
                        {c.field}: <span className="text-muted-foreground line-through">{String(c.from ?? "—")}</span> → {String(c.to ?? "—")}
                      </div>
                    ))}
                  </li>
                ))}
                {timeline.length === 0 ? <li className="text-muted-foreground">No history yet.</li> : null}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
