import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { MODULES, isModuleKey, type ModuleKey } from "@/server/access/modules";
import { parseFieldPermissions, parsePermissions } from "@/server/access/permissions";
import { ACTIONS } from "@/server/access/types";
import { saveFieldPermissionsAction, savePermissionsAction } from "@/server/modules/admin/actions";
import { getProfile, profileModuleFields } from "@/server/modules/admin/queries";
import { cfKey } from "@/server/modules/customization/engine";
import { listCustomFields } from "@/server/modules/customization/service";
import { requireContext } from "@/server/request";
import { cn } from "@/lib/utils";

const FIELD_LEVELS = [
  { value: "edit", label: "Editable" },
  { value: "read", label: "Read-only" },
  { value: "masked", label: "Masked" },
  { value: "hidden", label: "Hidden" },
];

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; module?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  const profile = await getProfile(ctx, id);
  if (!profile) notFound();
  const permissions = parsePermissions(profile.permissions);
  const fieldPerms = parseFieldPermissions(profile.fieldPermissions);
  const tab = sp.tab === "fields" ? "fields" : "permissions";
  const moduleKey: ModuleKey = sp.module && isModuleKey(sp.module) ? sp.module : "accounts";
  const custom = (await listCustomFields(ctx, moduleKey)).map((c) => cfKey(c.apiName));
  const fields = [...new Set([...profileModuleFields(moduleKey, profile.fieldPermissions), ...custom])];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{profile.name}</h2>
        <span className="text-sm text-muted-foreground">{profile._count.users} user(s)</span>
      </div>
      <div className="flex gap-1 text-sm">
        {(["permissions", "fields"] as const).map((t) => (
          <Link
            key={t}
            href={`/admin/profiles/${id}?tab=${t}`}
            className={cn("rounded-md px-3 py-1.5", tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {t === "permissions" ? "Permissions" : "Field-level security"}
          </Link>
        ))}
      </div>

      {tab === "permissions" ? (
        <Card>
          <CardHeader>
            <CardTitle>Permission grid</CardTitle>
            <CardDescription>Changes apply to every user of this profile on their next request.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={savePermissionsAction} className="space-y-4">
              <input type="hidden" name="id" value={profile.id} />
              <label className="flex items-center gap-2 text-sm">
                Scope
                <Select name="scope" defaultValue={profile.scope} className="w-56">
                  <option value="TERRITORY">TERRITORY – own territories</option>
                  <option value="ALL">ALL – every brand & region</option>
                </Select>
              </label>
              <div className="overflow-x-auto">
                <table className="text-sm" data-testid="permission-grid">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="pr-4 text-left font-medium">Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="px-2 font-medium">
                          {a}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => (
                      <tr key={m.key} className="border-t border-border">
                        <td className="py-1.5 pr-4">{m.label}</td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="px-2 text-center">
                            <input
                              type="checkbox"
                              name={`perm:${m.key}:${a}`}
                              defaultChecked={permissions[m.key]?.[a] === true}
                              aria-label={`${m.label} ${a}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SubmitButton>Save permissions</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Field-level security</CardTitle>
            <CardDescription>Hidden fields are removed, masked fields partially shown (e.g. phone 0803****21).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1 text-xs">
              {MODULES.filter((m) => m.model).map((m) => (
                <Link
                  key={m.key}
                  href={`/admin/profiles/${id}?tab=fields&module=${m.key}`}
                  className={cn("rounded px-2 py-1", m.key === moduleKey ? "bg-muted font-semibold" : "hover:bg-muted")}
                >
                  {m.label}
                </Link>
              ))}
            </div>
            <ActionForm action={saveFieldPermissionsAction} className="space-y-3">
              <input type="hidden" name="id" value={profile.id} />
              <input type="hidden" name="module" value={moduleKey} />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((f) => (
                  <label key={f} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <span className="font-mono">{f}</span>
                    <Select name={`field:${f}`} defaultValue={fieldPerms[moduleKey]?.[f] ?? "edit"} className="h-8 text-xs">
                      {FIELD_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              <SubmitButton>Save field security</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
