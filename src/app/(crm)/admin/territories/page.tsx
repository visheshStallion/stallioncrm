import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { setTerritoryManagerAction } from "@/server/modules/admin/actions";
import { adminLookups, territoryTree, type TerritoryNode } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Territories" };

function NodeRow({ node, users }: { node: TerritoryNode; users: Array<{ id: string; name: string }> }) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 py-1.5" style={{ paddingLeft: node.level * 24 }} data-testid="territory-node">
        <Link href={`/admin/territories/${node.id}`} className="font-medium text-primary hover:underline">
          {node.name}
        </Link>
        <span className="text-xs text-muted-foreground">{node.memberCount} member(s)</span>
        {node.level > 0 ? (
          <ActionForm action={setTerritoryManagerAction} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="territoryId" value={node.id} />
            <Select name="managerId" defaultValue={node.manager?.id ?? ""} aria-label={`Manager of ${node.name}`} className="h-8 w-48 text-xs">
              <option value="">— no manager —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="outline">
              Set
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
      {node.children.length ? (
        <ul className="border-l border-border">
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} users={users} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function TerritoriesPage() {
  const ctx = await requireContext();
  const [tree, lookups] = await Promise.all([territoryTree(ctx), adminLookups(ctx)]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Territory tree</CardTitle>
        <CardDescription>
          Group › Brand › Brand–Region. A brand node&apos;s manager is that brand&apos;s Brand Manager. Open a territory to
          manage members, delete it, or move its records.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="text-sm">
          {tree.map((n) => (
            <NodeRow key={n.id} node={n} users={lookups.activeUsers} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
