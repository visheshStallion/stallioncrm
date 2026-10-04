import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/server/modules/admin/actions";
import { adminLookups, roleTree, type RoleNode } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Roles" };

function RoleRow({ node, depth, roles }: { node: RoleNode; depth: number; roles: Array<{ id: string; name: string }> }) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1.5" style={{ paddingLeft: depth * 24 }} data-testid="role-node">
        <ActionForm action={updateRoleAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={node.id} />
          <Input name="name" defaultValue={node.name} className="h-8 w-56" aria-label={`Name of ${node.name}`} />
          <Select name="parentRoleId" defaultValue={node.parentRoleId ?? ""} className="h-8 w-52 text-xs" aria-label={`Reports to (${node.name})`}>
            <option value="">— top level —</option>
            {roles
              .filter((r) => r.id !== node.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  reports to {r.name}
                </option>
              ))}
          </Select>
          <SubmitButton size="sm" variant="outline">
            Save
          </SubmitButton>
        </ActionForm>
        <span className="text-xs text-muted-foreground">{node.userCount} user(s)</span>
        <ActionForm action={deleteRoleAction} confirm={`Delete role ${node.name}?`}>
          <input type="hidden" name="id" value={node.id} />
          <Button size="sm" variant="ghost" type="submit" disabled={node.userCount > 0 || node.children.length > 0}>
            Delete
          </Button>
        </ActionForm>
      </div>
      {node.children.length ? (
        <ul className="border-l border-border">
          {node.children.map((c) => (
            <RoleRow key={c.id} node={c} depth={depth + 1} roles={roles} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function RolesPage() {
  const ctx = await requireContext();
  const [tree, lookups] = await Promise.all([roleTree(ctx), adminLookups(ctx)]);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Reporting hierarchy</CardTitle>
          <CardDescription>Roles describe who reports to whom. Visibility comes from territories, permissions from profiles.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm">
            {tree.map((n) => (
              <RoleRow key={n.id} node={n} depth={0} roles={lookups.roles} />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New role</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRoleAction} className="flex flex-wrap gap-2">
            <Input name="name" placeholder="Role name" className="w-56" required />
            <Select name="parentRoleId" className="w-56" aria-label="Reports to">
              <option value="">— top level —</option>
              {lookups.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  reports to {r.name}
                </option>
              ))}
            </Select>
            <SubmitButton>Create role</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
