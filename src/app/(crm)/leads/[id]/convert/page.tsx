import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { convertLeadAction } from "@/server/modules/leads/actions";
import { findDuplicates, getLead } from "@/server/modules/leads/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Convert lead" };

export default async function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const lead = await getLead(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (lead.status === "CONVERTED" || !can(ctx, "leads", "edit", lead) || !can(ctx, "deals", "create", lead)) forbidden();
  const [dir, dupes] = await Promise.all([
    getDirectory(ctx),
    findDuplicates(ctx, { brandId: lead.brandId, mobile: lead.mobile, email: lead.email, excludeId: lead.id }),
  ]);
  // Existing accounts of matching contacts (shared customers) can be linked.
  const contactAccounts = dupes.contacts.length
    ? await scopedDb(ctx).contact.findMany({
        where: { id: { in: dupes.contacts.map((c) => c.id) } },
        select: { id: true, accountId: true, account: { select: { id: true, name: true } } },
      })
    : [];
  const brand = dir.brands.find((b) => b.id === lead.brandId);
  const defaultDealName = `${brand?.code ?? ""} ${lead.modelName ?? "Vehicle"} – ${lead.name}`.trim();

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Convert <BrandBadge brand={brand} /> {lead.name}
        </CardTitle>
        <CardDescription>
          Creates (or links) the shared Account and Contact and a Deal in {brand?.code} with the lead&apos;s region, model and
          owner. The lead becomes read-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={convertLeadAction} className="space-y-6">
          <input type="hidden" name="id" value={lead.id} />

          <fieldset className="space-y-2">
            <legend className="font-medium">1. Customer (account &amp; contact)</legend>
            {dupes.contacts.length ? (
              <div className="space-y-1 rounded-md bg-amber-50 p-3 text-sm" data-testid="existing-customers">
                <p>This customer may already exist – link instead of creating a duplicate:</p>
                {contactAccounts.map((c) => {
                  const contact = dupes.contacts.find((d) => d.id === c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="radio" name="contactId" value={c.id} /> {contact?.name}
                      {c.account ? <span className="text-muted-foreground">({c.account.name})</span> : null}
                    </label>
                  );
                })}
                <label className="flex items-center gap-2">
                  <input type="radio" name="contactId" value="" defaultChecked /> Create a new contact
                </label>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="accountMode" value="individual" defaultChecked /> New individual account
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="accountMode" value="company" /> New company account:
              </label>
              <Input name="companyName" placeholder="Company name" className="w-56" aria-label="Company name" />
              {contactAccounts.some((c) => c.account) ? (
                <label className="flex items-center gap-2">
                  <input type="radio" name="accountMode" value="existing" /> Existing account
                  <select name="accountId" className="h-8 rounded-md border border-border bg-background px-2" aria-label="Existing account">
                    {contactAccounts
                      .filter((c) => c.account)
                      .map((c) => (
                        <option key={c.account!.id} value={c.account!.id}>
                          {c.account!.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 font-medium sm:col-span-3">2. Deal</legend>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="dealName">Deal name</Label>
              <Input id="dealName" name="dealName" defaultValue={defaultDealName} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount (₦)</Label>
              <Input id="amount" name="amount" type="number" min={0} step="1000" defaultValue={lead.budget ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="closeDate">Expected close</Label>
              <Input id="closeDate" name="closeDate" type="date" />
            </div>
            <div className="space-y-1 text-sm">
              <span className="font-medium">Owner</span>
              <p className="pt-2">{lead.ownerName}</p>
            </div>
          </fieldset>

          <SubmitButton>Convert lead</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
