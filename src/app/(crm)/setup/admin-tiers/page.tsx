import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { grantBrandAdminAction, grantSuperAdminAction, requestDeactivateAdminAction, requestRevokeSuperAdminAction, revokeBrandAdminAction, setSetupSectionsAction } from "@/server/modules/setup/actions";
import { MAX_SUPER_ADMINS, tiersPageData } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { ReauthFields, Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "Administrators & Brand Admins" };

export default async function AdminTiersPage() {
  const { ctx, entry } = await requireSetup("admin-tiers"); // setupPermission: SA
  const { admins, brandAdmins, brands, profiles, delegable } = await tiersPageData(ctx);
  const superAdmins = admins.filter((a) => a.isSuperAdmin && a.active);
  return (
    <div>
      <SetupHeader entry={entry} />

      <Section
        title={`Administrators – ${superAdmins.length} of at most ${MAX_SUPER_ADMINS} Super Admins`}
        hint="Super Admins can do everything, including security policies, backup, purge and these tiers. Administrators can do all of Setup except the Super Admin functions. The last Super Admin cannot be disabled or demoted."
        testId="administrators"
      >
        <ul className="divide-y divide-border">
          {admins.map((a) => (
            <li key={a.id} className="space-y-2 py-2" data-testid="administrator" data-email={a.email}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{a.name}</span>
                <span className="text-text-muted">{a.email}</span>
                {a.isSuperAdmin ? <StatusPill tone="primary">Super Admin</StatusPill> : <StatusPill>Administrator</StatusPill>}
                {a.active ? null : <StatusPill tone="danger">Inactive</StatusPill>}
                <span className="ml-auto text-xs text-text-muted">last sign-in {fmtDateTime(a.lastLoginAt)}</span>
              </div>
              {a.active && a.id !== ctx.userId ? (
                <details>
                  <summary className="cursor-pointer text-primary">Change…</summary>
                  <ActionForm action={a.isSuperAdmin ? requestRevokeSuperAdminAction : grantSuperAdminAction} className="mt-2 space-y-2">
                    <input type="hidden" name="userId" value={a.id} />
                    <ReauthFields id={`tier-${a.id}`} note={a.isSuperAdmin ? "Revoking a Super Admin needs your password and the approval of a second Super Admin." : "Appointing a Super Admin needs your password."} />
                    <SubmitButton size="sm" variant="outline">
                      {a.isSuperAdmin ? "Request: revoke Super Admin" : "Make Super Admin"}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={requestDeactivateAdminAction} className="mt-3 space-y-2">
                    <input type="hidden" name="userId" value={a.id} />
                    <ReauthFields id={`off-${a.id}`} note="Deactivating an administrator needs your password and the approval of a second Super Admin." />
                    <SubmitButton size="sm" variant="outline">
                      Request: deactivate this administrator
                    </SubmitButton>
                  </ActionForm>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Brand Admins" hint="A Brand Admin gets Setup for one brand only: its team (territory membership) and its thresholds. They never see other brands, users of other brands, security or organisation-wide settings." testId="brand-admins">
        {brandAdmins.length === 0 ? <p className="text-text-muted">No Brand Admins.</p> : null}
        <ul className="divide-y divide-border">
          {brandAdmins.map((b) => (
            <li key={`${b.userId}:${b.brandId}`} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="brand-admin">
              <BrandBadge brand={{ code: b.brand.code }} />
              <span className="font-bold">{b.user.name}</span>
              <span className="text-text-muted">{b.user.email}</span>
              <ActionForm action={revokeBrandAdminAction} className="ml-auto" confirm={`Revoke ${b.user.name} as Brand Admin of ${b.brand.code}?`}>
                <input type="hidden" name="userId" value={b.userId} />
                <input type="hidden" name="brandId" value={b.brandId} />
                <Button size="sm" variant="ghost" type="submit">
                  Revoke
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={grantBrandAdminAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ba-email">User (e-mail)</Label>
            <Input id="ba-email" name="email" type="email" required className="w-72" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ba-brand">Brand</Label>
            <Select id="ba-brand" name="brandId" required className="w-56">
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </Select>
          </div>
          <SubmitButton variant="outline">Appoint Brand Admin</SubmitButton>
        </ActionForm>
      </Section>

      <Section title="Setup permissions of other profiles" hint="Lets a profile that is not Administrator open single Setup functions (for example a finance profile: Currencies). Security and tier functions can never be delegated." testId="setup-permissions">
        <ul className="divide-y divide-border">
          {profiles
            .filter((p) => !p.isAdmin)
            .map((p) => (
              <li key={p.id} className="py-2" data-testid="setup-permission-row" data-profile={p.name}>
                <ActionForm action={setSetupSectionsAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="profileId" value={p.id} />
                  <span className="w-40 font-bold">{p.name}</span>
                  {delegable.map((d) => (
                    <label key={d.key} className="flex items-center gap-1.5">
                      <input type="checkbox" name="sections" value={d.key} defaultChecked={p.setupSections.includes(d.key)} /> {d.label}
                    </label>
                  ))}
                  <SubmitButton size="sm" variant="outline" className="ml-auto">
                    Save
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
        </ul>
      </Section>
    </div>
  );
}
