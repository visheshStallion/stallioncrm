import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { RecordNav } from "@/components/crm/KeyboardShortcuts";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { tierAtLeast } from "@/server/access/customer-tier";
import { isAccessError } from "@/server/access/errors";
import { listCases } from "@/server/modules/cases/queries";
import { accountBrands, accountDeals, getAccount, listContacts } from "@/server/modules/customers/queries";
import { ACCOUNT_TYPE_LABELS, KYC_LABELS } from "@/server/modules/customers/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { RelatedDeals } from "../RelatedDeals";

const TIER_TEXT = {
  BASIC: "Basic details only – you have no records with this customer",
  CONTACT: "Contact details visible",
  SENSITIVE: "Full record",
} as const;

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "accounts", "read")) forbidden();
  const account = await getAccount(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs, brandIds, deals, contacts, cases] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    accountBrands(ctx, id),
    hasPermission(ctx, "deals", "read") ? accountDeals(ctx, { accountId: id }) : Promise.resolve([]),
    hasPermission(ctx, "contacts", "read") ? listContacts(ctx, { where: { accountId: id }, take: 50 }) : Promise.resolve({ rows: [], total: 0 }),
    // only cases of the viewer's brands (cases are brand-owned)
    hasPermission(ctx, "cases", "read") ? listCases(ctx, { queue: "all", accountId: id }, {}, { take: 20 }).then((r) => r.rows) : Promise.resolve([]),
  ]);
  const contact = tierAtLeast(account.tier, "CONTACT");
  const sensitive = tierAtLeast(account.tier, "SENSITIVE");

  return (
    <div>
      <RecordHeader
        backHref="/accounts"
        moduleLabel="Account"
        title={account.name}
        owner={account.ownerName}
        meta={
          <>
            <StatusPill>{ACCOUNT_TYPE_LABELS[account.type as keyof typeof ACCOUNT_TYPE_LABELS]}</StatusPill>
            <StatusPill tone={sensitive ? "success" : contact ? "primary" : "warning"}>
              <span data-testid="customer-tier" data-tier={account.tier}>
                {TIER_TEXT[account.tier]}
              </span>
            </StatusPill>
          </>
        }
        nav={<RecordNav module="accounts" id={account.id} basePath="/accounts" />}
        actions={
          can(ctx, "accounts", "edit") ? (
            <Button asChild>
              <Link href={`/accounts/${account.id}/edit`} data-shortcut="edit">
                Edit
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="customer-brands">
        <span className="text-text-muted">Brands this customer buys:</span>
        {brandIds.length ? brandIds.map((b) => <BrandBadge key={b} brand={dir.brands.find((x) => x.id === b)} />) : <span className="text-text-muted">—</span>}
      </div>
      <div className="flex items-start gap-4">
        <RelatedNav
          items={[
            { id: "info", label: "Account Information" },
            { id: "contact-details", label: "Contact Details" },
            { id: "contacts", label: "Contacts" },
            { id: "deals", label: "Deals" },
            { id: "quotes", label: "Quotes / Sales Orders" },
            { id: "cases", label: "Cases" },
            { id: "activities", label: "Activities" },
          ]}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <FieldSection title="Account Information" id="info">
            <Field label="Account name" value={account.name} />
            <Field label="Type" value={ACCOUNT_TYPE_LABELS[account.type as keyof typeof ACCOUNT_TYPE_LABELS]} />
            <Field label="City" value={account.city} />
            <Field label="Industry" value={account.industry} />
            <Field label="Phone" value={account.phone} masked={!contact && !!account.phone} />
            <Field label="Created" value={formatDateTime(account.createdAt, prefs.dateFormat)} />
          </FieldSection>
          <FieldSection title="Contact Details" id="contact-details">
            <Field label="Email" value={account.email} hidden={!contact} />
            <Field label="Address" value={account.address} hidden={!contact} />
            <Field label="State" value={account.state} hidden={!contact} />
            <Field label="Website" value={account.website} hidden={!contact} />
            <Field label="Notes" value={account.notes} hidden={!contact} />
            <Field label="RC number" value={account.rcNumber} hidden={!sensitive} />
            <Field label="Credit limit" value={formatMoney(account.creditLimit)} hidden={!sensitive} />
            <Field label="KYC status" value={account.kycStatus ? KYC_LABELS[account.kycStatus as keyof typeof KYC_LABELS] : null} hidden={!sensitive} />
            {!contact ? <p className="py-2 text-[13px] text-text-muted sm:col-span-2">Contact details are visible once you have a record with this customer.</p> : null}
          </FieldSection>
          <RelatedListCard id="contacts" title="Contacts" newHref={can(ctx, "contacts", "create") ? `/contacts/new?accountId=${account.id}` : undefined} empty="No contacts.">
            {contacts.rows.length ? (
              <ul className="divide-y divide-border">
                {contacts.rows.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5">
                    <Link href={`/contacts/${c.id}`} className="flex-1 font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-text-muted">{c.mobile ?? "—"}</span>
                    <span className="w-56 truncate text-text-muted">{c.email ?? ""}</span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </RelatedListCard>
          <RelatedDeals deals={deals} brands={dir.brands} dateFormat={prefs.dateFormat} />
          <RelatedListCard id="quotes" title="Quotes / Sales Orders" empty="Quotes arrive with prompt 06." />
          <RelatedListCard id="cases" title="Cases" count={cases.length} newHref={hasPermission(ctx, "cases", "create") ? `/cases/new?accountId=${account.id}` : undefined} empty="No cases in your brands.">
            {cases.length ? (
              <ul className="divide-y divide-border">
                {cases.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5">
                    <Link href={`/cases/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                    <span className="text-xs text-text-muted">{c.status.charAt(0) + c.status.slice(1).toLowerCase().replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </RelatedListCard>
          <RelatedListCard id="activities" title="Activities" empty="Activities arrive with prompt 07." />
        </div>
      </div>
    </div>
  );
}
