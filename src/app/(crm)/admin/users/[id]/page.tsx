import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  activateUserAction,
  deactivateUserAction,
  saveUserTerritoriesAction,
  setPasswordAction,
  updateUserAction,
} from "@/server/modules/admin/actions";
import { adminLookups, getUser, userVisibility } from "@/server/modules/admin/queries";
import { deactivationPreview } from "@/server/modules/admin/service";
import { requireContext } from "@/server/request";
import { pickerData } from "../picker-data";
import { TerritoryPicker } from "../TerritoryPicker";
import { UserFields } from "../UserFields";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const [user, lookups] = await Promise.all([getUser(ctx, id), adminLookups(ctx)]);
  if (!user) notFound();
  const [visibility, preview] = await Promise.all([
    userVisibility(ctx, id),
    user.active ? deactivationPreview(ctx, id) : Promise.resolve([]),
  ]);
  const cells = new Set(visibility.cells);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{user.name}</h2>
        <span className="text-sm text-muted-foreground">
          {user.role.name} · {user.profile.name}
        </span>
        <span className={user.active ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
          {user.active ? "Active" : "Inactive"}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateUserAction} className="space-y-3">
            <input type="hidden" name="id" value={user.id} />
            <UserFields
              values={user}
              roles={lookups.roles}
              profiles={lookups.profiles}
              managers={lookups.activeUsers.filter((u) => u.id !== user.id)}
              passwordLabel="New password (optional)"
            />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Territories of this user</CardTitle>
          <CardDescription>Takes effect on the user&apos;s next request.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveUserTerritoriesAction} className="space-y-3">
            <input type="hidden" name="id" value={user.id} />
            <TerritoryPicker {...pickerData(lookups)} initial={user.memberships.map((m) => m.territoryId)} />
            <SubmitButton>Save territories</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What can this user see?</CardTitle>
          <CardDescription>
            Computed by the access engine: {visibility.scope === "ALL" ? "scope ALL – every brand and region" : "territory memberships"}
            {visibility.active ? ", plus any record the user owns." : " – user is inactive and cannot sign in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-sm" data-testid="visibility-matrix">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pr-3 text-left font-medium">Brand</th>
                {visibility.regions.map((r) => (
                  <th key={r.id} className="px-3 font-medium">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibility.brands.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <BrandBadge brand={b} />
                  </td>
                  {visibility.regions.map((r) => (
                    <td key={r.id} className="px-3 text-center">
                      {cells.has(`${b.id}|${r.id}`) ? (
                        <span className="text-emerald-700" aria-label="visible">●</span>
                      ) : (
                        <span className="text-muted-foreground/40" aria-label="hidden">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password &amp; status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={setPasswordAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={user.id} />
            <Input name="password" type="password" minLength={10} required placeholder="New password" className="w-64" autoComplete="new-password" />
            <SubmitButton size="sm" variant="outline">
              Set password
            </SubmitButton>
          </ActionForm>

          {user.active ? (
            <div className="space-y-2" data-testid="deactivation-preview">
              <p className="text-sm font-medium">Deactivation preview – open records are reassigned to each brand&apos;s Brand Manager:</p>
              {preview.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open records.</p>
              ) : (
                <ul className="text-sm">
                  {preview.map((l) => (
                    <li key={`${l.model}:${l.brandId}`}>
                      {l.count} {l.model} ({l.brandCode}) → {l.targetName ?? <span className="text-amber-700">{l.problem}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={deactivateUserAction} confirm={`Deactivate ${user.name} and reassign their open records?`}>
                <input type="hidden" name="id" value={user.id} />
                <SubmitButton size="sm" variant="destructive">
                  Deactivate user
                </SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={activateUserAction}>
              <input type="hidden" name="id" value={user.id} />
              <SubmitButton size="sm">Activate user</SubmitButton>
            </ActionForm>
          )}
          <p className="text-xs text-muted-foreground">
            History: <Link href={`/admin/audit?userId=${user.id}`} className="underline">actions by this user</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
