import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createProfileAction } from "@/server/modules/admin/actions";
import { listProfiles } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Profiles" };

export default async function ProfilesPage() {
  const ctx = await requireContext();
  const profiles = await listProfiles(ctx);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>Permissions only – brand is never encoded in a profile; visibility comes from territories.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {profiles.map((p) => (
            <Link key={p.id} href={`/admin/profiles/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50" data-testid="profile-row">
              <span className="font-medium text-primary">{p.name}</span>
              <Badge>scope {p.scope}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{p._count.users} user(s)</span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New profile (clone)</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createProfileAction} className="flex flex-wrap gap-2">
            <Input name="name" placeholder="Profile name" className="w-56" required />
            <Select name="cloneFromId" required className="w-56" aria-label="Clone from">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  clone of {p.name}
                </option>
              ))}
            </Select>
            <SubmitButton>Create</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
