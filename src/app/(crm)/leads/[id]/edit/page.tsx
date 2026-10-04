import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { updateLeadAction } from "@/server/modules/leads/actions";
import { getLead, leadFormLookups } from "@/server/modules/leads/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { LeadFormFields } from "../../LeadFormFields";

export const metadata = { title: "Edit Lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const lead = await getLead(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (lead.status === "CONVERTED" || !can(ctx, "leads", "edit", lead)) forbidden();
  const [lookups, dir] = await Promise.all([leadFormLookups(ctx), getDirectory(ctx)]);
  const brand = dir.brands.find((b) => b.id === lead.brandId);
  const region = dir.regions.find((r) => r.id === lead.regionId);
  // The edit form needs the lead's own brand / region even if the user could not create there.
  const formLookups = {
    ...lookups,
    brands: lookups.brands.some((b) => b.id === lead.brandId) ? lookups.brands : [...lookups.brands, { id: lead.brandId, code: brand?.code ?? "?", name: brand?.name ?? "" }],
    regions: lookups.regions.some((r) => r.id === lead.regionId) ? lookups.regions : [...lookups.regions, { id: lead.regionId, name: region?.name ?? "?" }],
  };
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit Lead: ${lead.name}`} left={<BrandBadge brand={brand} />} />
      <ActionForm action={updateLeadAction} className="space-y-4">
        <input type="hidden" name="id" value={lead.id} />
        <LeadFormFields lookups={formLookups} values={lead} mode="edit" />
        <StickyFormFooter cancelHref={`/leads/${lead.id}`}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
