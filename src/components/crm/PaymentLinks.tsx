import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AccessContext } from "@/server/access/types";
import { brandForIntegration } from "@/server/db/api-store";
import { invoicePaymentLinks, providersFor } from "@/server/integrations/payments";
import { createPaymentLinkAction } from "@/server/modules/api/actions";

/**
 * Online payment links of an invoice (prompt 13). Rendered only when the invoice's brand has a payment
 * provider configured – every brand is a separate merchant.
 */
export async function PaymentLinks({ ctx, invoiceId, brandId, canCreate, balance }: { ctx: AccessContext; invoiceId: string; brandId: string; canCreate: boolean; balance: number }) {
  const brand = await brandForIntegration(brandId);
  const providers = brand ? providersFor(brand.code) : [];
  if (providers.length === 0) return null;
  const links = await invoicePaymentLinks(ctx, invoiceId);
  return (
    <div className="space-y-2 border-t border-border pt-3 text-[13px]" data-testid="payment-links">
      <h3 className="font-semibold">Online payment links</h3>
      {links.length ? (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3">
              <span className="w-24 capitalize">{l.provider}</span>
              <span className="w-28 tabular-nums">{l.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              <span className="w-20">{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</span>
              {l.status === "PENDING" ? (
                <a href={l.url} target="_blank" rel="noreferrer" className="break-all text-primary underline">
                  {l.url}
                </a>
              ) : (
                <span className="font-mono text-xs text-text-muted">{l.reference}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-muted">No payment links yet.</p>
      )}
      {canCreate ? (
        <ActionForm action={createPaymentLinkAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Select name="provider" aria-label="Payment provider" className="h-8" defaultValue={providers[0]!.key}>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input name="amount" type="number" min={0} step="0.01" defaultValue={balance} aria-label="Link amount (deposit or balance)" className="h-8 w-40 text-right" />
          <Input name="email" type="email" placeholder="Customer e-mail (if not on the contact)" aria-label="Customer e-mail" className="h-8 w-64" />
          <SubmitButton size="sm" variant="outline">
            Create payment link
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
