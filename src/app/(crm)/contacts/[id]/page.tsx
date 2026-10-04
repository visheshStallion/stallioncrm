import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { RecordNav } from "@/components/crm/KeyboardShortcuts";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard, RelatedNav } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { tierAtLeast } from "@/server/access/customer-tier";
import { isAccessError } from "@/server/access/errors";
import { setConsentAction } from "@/server/modules/customers/actions";
import { accountDeals, contactConsents, getContact } from "@/server/modules/customers/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { RelatedDeals } from "../../accounts/RelatedDeals";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "contacts", "read")) forbidden();
  const contact = await getContact(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs, consents, deals] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    contactConsents(ctx, id),
    hasPermission(ctx, "deals", "read") ? accountDeals(ctx, { contactId: id }) : Promise.resolve([]),
  ]);
  const detail = tierAtLeast(contact.tier, "CONTACT");
  const canEdit = can(ctx, "contacts", "edit");
  // Consent can be recorded for the brands the viewer works in (active brands only).
  const consentBrands = dir.myBrands.filter((b) => b.status === "ACTIVE");

  return (
    <div>
      <RecordHeader
        backHref="/contacts"
        moduleLabel="Contact"
        title={contact.name}
        owner={contact.ownerName}
        meta={
          <StatusPill tone={detail ? "primary" : "warning"}>
            <span data-testid="customer-tier" data-tier={contact.tier}>
              {detail ? "Contact details visible" : "Basic details only"}
            </span>
          </StatusPill>
        }
        nav={<RecordNav module="contacts" id={contact.id} basePath="/contacts" />}
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={`/contacts/${contact.id}/edit`} data-shortcut="edit">
                Edit
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex items-start gap-4">
        <RelatedNav
          items={[
            { id: "info", label: "Contact Information" },
            { id: "consent", label: "Marketing Consent" },
            { id: "deals", label: "Deals" },
            { id: "activities", label: "Activities" },
          ]}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <FieldSection title="Contact Information" id="info">
            <Field label="First name" value={contact.firstName} />
            <Field label="Last name" value={contact.lastName} />
            <Field
              label="Account"
              value={
                contact.accountId ? (
                  <Link href={`/accounts/${contact.accountId}`} className="text-primary hover:underline">
                    {contact.accountName}
                  </Link>
                ) : null
              }
            />
            <Field label="City" value={contact.city} />
            <Field label="Mobile" value={contact.mobile} masked={!detail && !!contact.mobile} />
            <Field label="Alternative phone" value={contact.altPhone} hidden={!detail} />
            <Field label="Email" value={contact.email} hidden={!detail} />
            <Field label="Preferred channel" value={contact.preferredChannel} hidden={!detail} />
            <Field label="Date of birth" value={formatDate(contact.dateOfBirth, prefs.dateFormat)} hidden={!detail} />
            <Field label="Gender" value={contact.gender} hidden={!detail} />
            <Field label="Address" value={contact.address} hidden={!detail} />
          </FieldSection>

          <RelatedListCard id="consent" title="Marketing consent (per brand)">
            <p className="mb-2 text-xs text-text-muted">Consent is recorded per brand: opting out of one brand does not opt out of another.</p>
            <ul className="divide-y divide-border" data-testid="consent-list">
              {consentBrands.map((b) => {
                const c = consents.find((x) => x.brandId === b.id);
                return (
                  <li key={b.id} className="flex items-center gap-3 py-1.5" data-testid="consent-row">
                    <BrandBadge brand={b} />
                    <span className="flex-1">
                      {c ? (
                        <>
                          {c.consent ? "Opted in" : "Opted out"} <span className="text-xs text-text-muted">({formatDate(c.at, prefs.dateFormat)})</span>
                        </>
                      ) : (
                        <span className="text-text-muted">Not recorded</span>
                      )}
                    </span>
                    {canEdit ? (
                      <ActionForm action={setConsentAction} className="flex gap-1">
                        <input type="hidden" name="contactId" value={contact.id} />
                        <input type="hidden" name="brandId" value={b.id} />
                        <Button size="sm" variant="outline" type="submit" name="consent" value="true" disabled={c?.consent === true}>
                          Opt in
                        </Button>
                        <Button size="sm" variant="outline" type="submit" name="consent" value="false" disabled={c?.consent === false}>
                          Opt out
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </RelatedListCard>

          <RelatedDeals deals={deals} brands={dir.brands} dateFormat={prefs.dateFormat} />
          <RelatedListCard id="activities" title="Activities" empty="Activities arrive with prompt 07." />
        </div>
      </div>
    </div>
  );
}
