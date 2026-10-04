import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { SecretForm } from "@/components/crm/SecretForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { scopedDb } from "@/server/db";
import { assertAdmin } from "@/server/modules/admin/guard";
import { createClientAction, createIntegrationTokenAction, createPrincipalAction, revokeTokenAction, setClientActiveAction } from "@/server/modules/api/actions";
import { listAllTokens, listClients, listPrincipals } from "@/server/modules/api/tokens";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "API & integrations" };
const th = "px-3 py-2";
const head = "border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted";

/** Integration principals, their tokens and OAuth clients; every API token in the system (prompt 13). Administrators only. */
export default async function ApiAdminPage() {
  const ctx = await requireContext();
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const [principals, tokens, clients, dir, prefs, roles, profiles] = await Promise.all([
    listPrincipals(ctx),
    listAllTokens(ctx),
    listClients(ctx),
    getDirectory(ctx),
    getPreferences(ctx),
    db.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.profile.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const code = (id: string) => dir.brands.find((b) => b.id === id)?.code ?? "?";
  const brandBoxes = (legend: string) => (
    <fieldset className="text-[13px]">
      <legend className="mb-1 text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {dir.brands.map((b) => (
          <label key={b.id} className="flex items-center gap-1">
            <input type="checkbox" name="brandIds" value={b.id} /> {b.code}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const principalSelect = (id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>Integration principal</Label>
      <Select id={id} name="userId" required defaultValue="" className="w-56">
        <option value="">Choose…</option>
        {principals
          .filter((p) => p.active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
    </div>
  );
  const now = Date.now();
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-muted">
        Every token acts as a user or an integration principal: the API applies the same brand isolation, permissions and field masks as the application. API documentation:{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- an API route, not a page */}
        <a href="/api/v1/docs" className="text-primary underline">
          /api/v1/docs
        </a>{" "}
        · outbound events:{" "}
        <Link href="/admin/webhooks" className="text-primary underline">
          Webhooks
        </Link>
      </p>

      <section className="rounded-lg border border-border bg-surface" data-testid="principals">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Integration principals</h2>
        {principals.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className={head}>
                <th className={th}>Name</th>
                <th className={th}>Profile</th>
                <th className={th}>Brands</th>
                <th className={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {principals.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={`${th} font-medium`}>{p.name}</td>
                  <td className={th}>{p.profile.name}</td>
                  <td className={th}>{p.profile.scope === "ALL" ? "All brands" : [...new Set(p.memberships.map((m) => (m.territory.brandId ? code(m.territory.brandId) : null)).filter(Boolean))].join(", ") || "—"}</td>
                  <td className={th}>
                    <StatusPill tone={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Inactive"}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-[13px] text-text-muted">No integration principals yet.</p>
        )}
        <div className="border-t border-border p-4">
          <h3 className="mb-2 text-[13px] font-semibold">New principal</h3>
          <ActionForm action={createPrincipalAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" name="name" required maxLength={100} placeholder="e.g. ERP connector HMNL" className="w-64" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-role">Role</Label>
              <Select id="p-role" name="roleId" required defaultValue="" className="w-48">
                <option value="">Choose…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-profile">Profile (permissions and field security)</Label>
              <Select id="p-profile" name="profileId" required defaultValue="" className="w-56">
                <option value="">Choose…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            {brandBoxes("Brands the principal works for")}
            <SubmitButton variant="outline">Create principal</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-text-muted">A principal cannot sign in. It sees the chosen brands (all regions) with the permissions of its profile; deactivate it or change its territories under Users.</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="integration-token-form">
        <h2 className="mb-2 text-[13px] font-semibold">New integration token</h2>
        <SecretForm action={createIntegrationTokenAction} className="flex flex-wrap items-end gap-3">
          {principalSelect("t-user")}
          <div className="space-y-1">
            <Label htmlFor="t-name">Token name</Label>
            <Input id="t-name" name="name" required maxLength={80} className="w-56" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-exp">Expires after (days)</Label>
            <Input id="t-exp" name="expiresInDays" type="number" min={1} max={3650} className="w-32" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-rate">Requests / minute</Label>
            <Input id="t-rate" name="rateLimit" type="number" min={1} max={6000} defaultValue={300} className="w-32" />
          </div>
          {brandBoxes("Limit the token to (none ticked = all brands of the principal)")}
          <SubmitButton variant="outline">Create token</SubmitButton>
        </SecretForm>
      </section>

      <section className="rounded-lg border border-border bg-surface" data-testid="oauth-clients">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">OAuth2 clients (client credentials)</h2>
        {clients.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className={head}>
                <th className={th}>Name</th>
                <th className={th}>Client id</th>
                <th className={th}>Principal</th>
                <th className={th}>Brands</th>
                <th className={th}>State</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className={th}>{c.name}</td>
                  <td className={`${th} font-mono text-xs`}>{c.clientId}</td>
                  <td className={th}>{principals.find((p) => p.id === c.userId)?.name ?? "—"}</td>
                  <td className={th}>{c.brandIds.length ? c.brandIds.map(code).join(", ") : "All of the principal"}</td>
                  <td className={th}>
                    <StatusPill tone={c.active ? "success" : "neutral"}>{c.active ? "Active" : "Disabled"}</StatusPill>
                  </td>
                  <td className={`${th} text-right`}>
                    <ActionForm action={setClientActiveAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                      <SubmitButton size="sm" variant="ghost">
                        {c.active ? "Disable" : "Enable"}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="p-4">
          <SecretForm action={createClientAction} className="flex flex-wrap items-end gap-3">
            {principalSelect("c-user")}
            <div className="space-y-1">
              <Label htmlFor="c-name">Client name</Label>
              <Input id="c-name" name="name" required maxLength={80} className="w-56" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-rate">Requests / minute</Label>
              <Input id="c-rate" name="rateLimit" type="number" min={1} max={6000} defaultValue={300} className="w-32" />
            </div>
            {brandBoxes("Limit the client to (none ticked = all brands of the principal)")}
            <SubmitButton variant="outline">Create client</SubmitButton>
          </SecretForm>
          <p className="mt-2 text-xs text-text-muted">Token endpoint: POST /api/public/oauth/token with grant_type=client_credentials; access tokens last one hour.</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface" data-testid="all-tokens">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">All API tokens</h2>
        {tokens.length === 0 ? (
          <p className="p-4 text-[13px] text-text-muted">No tokens yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className={head}>
                <th className={th}>Name</th>
                <th className={th}>Acts as</th>
                <th className={th}>Kind</th>
                <th className={th}>Token</th>
                <th className={th}>Brands</th>
                <th className={th}>Last used</th>
                <th className={th}>State</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const expired = !!t.expiresAt && t.expiresAt.getTime() <= now;
                return (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className={th}>{t.name}</td>
                    <td className={th}>{t.userName}</td>
                    <td className={th}>{t.kind.charAt(0) + t.kind.slice(1).toLowerCase()}</td>
                    <td className={`${th} font-mono text-xs`}>{t.prefix}…</td>
                    <td className={th}>{t.brandIds.length ? t.brandIds.map(code).join(", ") : "—"}</td>
                    <td className={th}>{t.lastUsedAt ? formatDateTime(t.lastUsedAt, prefs.dateFormat) : "Never"}</td>
                    <td className={th}>
                      <StatusPill tone={t.revokedAt ? "neutral" : expired ? "warning" : "success"}>{t.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}</StatusPill>
                    </td>
                    <td className={`${th} text-right`}>
                      {!t.revokedAt ? (
                        <ActionForm action={revokeTokenAction} confirm={`Revoke "${t.name}"?`}>
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
