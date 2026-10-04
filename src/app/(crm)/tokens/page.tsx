import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { SecretForm } from "@/components/crm/SecretForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { createPersonalTokenAction, revokeTokenAction } from "@/server/modules/api/actions";
import { listMyTokens } from "@/server/modules/api/tokens";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "My API tokens" };

/** Personal access tokens (prompt 13): a token acts as the signed-in user – same brands, permissions and masks. */
export default async function MyTokensPage() {
  const ctx = await requireContext();
  const [tokens, dir, prefs] = await Promise.all([listMyTokens(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const now = Date.now();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageTitleRow title="My API tokens" left={<span className="text-[13px] text-text-muted">a token sees exactly what you see · documentation at /api/v1/docs</span>} />
      <section className="rounded-lg border border-border bg-surface p-4" data-testid="token-form">
        <h2 className="mb-2 text-[13px] font-semibold">New token</h2>
        <SecretForm action={createPersonalTokenAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="name">Name (what is it for?)</Label>
            <Input id="name" name="name" required maxLength={80} className="w-64" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="expiresInDays">Expires after (days, empty = never)</Label>
            <Input id="expiresInDays" name="expiresInDays" type="number" min={1} max={3650} defaultValue={90} className="w-40" />
          </div>
          {dir.myBrands.length > 1 ? (
            <fieldset className="text-[13px]">
              <legend className="mb-1 text-xs font-medium">Limit to brands (none ticked = all of yours)</legend>
              <div className="flex flex-wrap gap-3">
                {dir.myBrands.map((b) => (
                  <label key={b.id} className="flex items-center gap-1">
                    <input type="checkbox" name="brandIds" value={b.id} /> {b.code}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <SubmitButton>Create token</SubmitButton>
        </SecretForm>
      </section>
      <section className="rounded-lg border border-border bg-surface">
        {tokens.length === 0 ? (
          <EmptyState title="No tokens yet" />
        ) : (
          <table className="w-full text-[13px]" data-testid="tokens">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Token</th>
                <th className="px-3 py-2">Brands</th>
                <th className="px-3 py-2">Last used</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const expired = !!t.expiresAt && t.expiresAt.getTime() <= now;
                return (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.prefix}…</td>
                    <td className="px-3 py-2">{t.brandIds.length ? t.brandIds.map((id) => dir.brands.find((b) => b.id === id)?.code ?? "?").join(", ") : "All of mine"}</td>
                    <td className="px-3 py-2">{t.lastUsedAt ? formatDateTime(t.lastUsedAt, prefs.dateFormat) : "Never"}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={t.revokedAt ? "neutral" : expired ? "warning" : "success"}>{t.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!t.revokedAt ? (
                        <ActionForm action={revokeTokenAction} confirm={`Revoke "${t.name}"? Applications using it stop working.`}>
                          <input type="hidden" name="id" value={t.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Revoke
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
