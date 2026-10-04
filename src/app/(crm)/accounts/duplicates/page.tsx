import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { mergeAccountsAction } from "@/server/modules/customers/actions";
import { duplicateAccountGroups } from "@/server/modules/customers/queries";
import { canMergeCustomers } from "@/server/modules/customers/service";
import { requireContext } from "@/server/request";

export const metadata = { title: "Merge duplicate accounts" };

/** Merge wizard (Administrators / Management only – others get 404). */
export default async function DuplicateAccountsPage() {
  const ctx = await requireContext();
  if (!canMergeCustomers(ctx)) notFound();
  const groups = await duplicateAccountGroups(ctx);

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Find & merge duplicate accounts" left={<span className="text-[13px] text-text-muted">{groups.length} possible duplicate group(s)</span>} />
      <p className="mb-3 text-[13px] text-text-muted">
        Match rules: same phone, same email, same RC number, or similar name in the same city. Choose the record to keep; the
        others are merged into it – contacts and every deal, quote, order and case of every brand move to the kept record, empty
        fields are filled from the duplicates, and the merge is audited.
      </p>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No duplicates found" />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <ActionForm
              key={g.members.map((m) => m.id).join("-")}
              action={mergeAccountsAction}
              confirm="Merge the selected accounts into the one marked “keep”? This cannot be undone."
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-[13px]" data-testid="duplicate-group">
                <span className="font-semibold">Group {i + 1}</span>
                {g.reasons.map((r) => (
                  <StatusPill key={r} tone="warning">
                    same {r}
                  </StatusPill>
                ))}
              </div>
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="w-14 py-1">Keep</th>
                    <th className="w-16">Merge</th>
                    <th>Name</th>
                    <th>City</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>RC no.</th>
                    <th className="text-right">Deals</th>
                    <th className="text-right">Contacts</th>
                  </tr>
                </thead>
                <tbody>
                  {g.members.map((m, idx) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-1.5">
                        <input type="radio" name="masterId" value={m.id} defaultChecked={idx === 0} aria-label={`Keep ${m.name}`} required />
                      </td>
                      <td>
                        <input type="checkbox" name="ids" value={m.id} defaultChecked aria-label={`Merge ${m.name}`} />
                      </td>
                      <td>
                        <Link href={`/accounts/${m.id}`} className="text-primary hover:underline" target="_blank">
                          {m.name}
                        </Link>
                      </td>
                      <td>{m.city ?? "—"}</td>
                      <td>{m.phone ?? "—"}</td>
                      <td>{m.email ?? "—"}</td>
                      <td>{m.rcNumber ?? "—"}</td>
                      <td className="text-right">{m.deals}</td>
                      <td className="text-right">{m.contacts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex justify-end">
                <SubmitButton size="sm">Merge selected</SubmitButton>
              </div>
            </ActionForm>
          ))}
        </div>
      )}
    </div>
  );
}
