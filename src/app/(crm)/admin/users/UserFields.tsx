import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Option = { id: string; name: string };

/** Shared user form fields (create + edit). */
export function UserFields({
  values = {},
  roles,
  profiles,
  managers,
  passwordLabel = "Initial password (optional – leave empty for SSO-only)",
}: {
  values?: { name?: string; email?: string; roleId?: string; profileId?: string; managerId?: string | null };
  roles: Option[];
  profiles: Option[];
  managers: Option[];
  passwordLabel?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={values.name} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={values.email} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="managerId">Manager</Label>
        <Select id="managerId" name="managerId" defaultValue={values.managerId ?? ""} className="w-full">
          <option value="">— none —</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="roleId">Role</Label>
        <Select id="roleId" name="roleId" defaultValue={values.roleId ?? ""} required className="w-full">
          <option value="">Choose…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="profileId">Profile</Label>
        <Select id="profileId" name="profileId" defaultValue={values.profileId ?? ""} required className="w-full">
          <option value="">Choose…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">{passwordLabel}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} />
      </div>
    </div>
  );
}
