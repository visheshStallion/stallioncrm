import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { FormSection, Required, StickyFormFooter } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { createCaseAction } from "@/server/modules/cases/actions";
import { CASE_CHANNELS, CASE_PRIORITIES, CASE_TYPES, CHANNEL_LABELS, PRIORITY_LABELS, TYPE_LABELS } from "@/server/modules/cases/schema";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Create Case" };

/** New case – from scratch (choose brand and region), or from a deal / account (`?dealId=` / `?accountId=`). */
export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ dealId?: string; accountId?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "cases", "create")) forbidden();
  const db = scopedDb(ctx);
  const [lookups, deal, account] = await Promise.all([
    leadFormLookups(ctx),
    sp.dealId ? db.deal.findUnique({ where: { id: sp.dealId }, select: { id: true, name: true, brandId: true, regionId: true, vinChassisNo: true, customerName: true, brand: { select: { code: true } }, region: { select: { name: true } } } }) : null,
    sp.accountId ? db.account.findFirst({ where: { id: sp.accountId, deletedAt: null }, select: { id: true, name: true } }) : null,
  ]);
  if ((sp.dealId && !deal) || (sp.accountId && !account)) notFound(); // missing or outside the user's scope

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitleRow title="Create Case" />
      <ActionForm action={createCaseAction} className="space-y-4">
        {deal ? <input type="hidden" name="dealId" value={deal.id} /> : null}
        {account ? <input type="hidden" name="accountId" value={account.id} /> : null}
        <FormSection title="Case Information">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="subject">
              Subject
              <Required />
            </Label>
            <Input id="subject" name="subject" required maxLength={200} />
          </div>
          {deal ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="deal">Deal (the case takes its brand, region and customer)</Label>
              <Input id="deal" value={`${deal.name} – ${deal.brand.code} ${deal.region.name}`} readOnly disabled />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="brandId">
                  Brand
                  <Required />
                </Label>
                <Select id="brandId" name="brandId" required className="w-full" defaultValue={lookups.defaultBrandId ?? ""}>
                  <option value="">Choose brand…</option>
                  {lookups.brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} – {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="regionId">
                  Region
                  <Required />
                </Label>
                <Select id="regionId" name="regionId" required className="w-full" defaultValue={lookups.defaultRegionId ?? ""}>
                  <option value="">Choose region…</option>
                  {lookups.regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          {account ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="account">Account</Label>
              <Input id="account" value={account.name} readOnly disabled />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="type">Type</Label>
            <Select id="type" name="type" className="w-full" defaultValue="ENQUIRY">
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="priority">Priority (sets the SLA)</Label>
            <Select id="priority" name="priority" className="w-full" defaultValue="MEDIUM">
              {CASE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="channel">Channel</Label>
            <Select id="channel" name="channel" className="w-full" defaultValue="PHONE">
              {CASE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vin">VIN / chassis no.</Label>
            <Input id="vin" name="vin" maxLength={40} className="font-mono uppercase" defaultValue={deal?.vinChassisNo ?? ""} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <textarea id="description" name="description" rows={5} maxLength={5000} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          </div>
        </FormSection>
        {!deal ? (
          <FormSection title="Customer">
            <div className="space-y-1">
              <Label htmlFor="customerName">Name</Label>
              <Input id="customerName" name="customerName" maxLength={160} defaultValue={account?.name ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customerPhone">Mobile</Label>
              <Input id="customerPhone" name="customerPhone" type="tel" maxLength={40} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customerEmail">Email</Label>
              <Input id="customerEmail" name="customerEmail" type="email" maxLength={254} />
            </div>
          </FormSection>
        ) : null}
        <StickyFormFooter cancelHref={deal ? `/deals/${deal.id}` : account ? `/accounts/${account.id}` : "/cases"}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
