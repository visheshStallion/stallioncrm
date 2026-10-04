import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  addMemberAction,
  deleteTerritoryAction,
  moveRecordsAction,
  removeMemberAction,
} from "@/server/modules/admin/actions";
import { adminLookups, getTerritory } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export default async function TerritoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const [t, lookups] = await Promise.all([getTerritory(ctx, id), adminLookups(ctx)]);
  if (!t) notFound();
  const recordTotal = Object.values(t.records).reduce((a, b) => a + b, 0);
  const memberIds = new Set(t.members.map((m) => m.userId));
  const targets = lookups.territories.filter((x) => x.level === 2 && x.id !== t.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {t.brand ? <BrandBadge brand={t.brand} size="lg" /> : null}
        <h2 className="text-xl font-semibold">{t.name}</h2>
        {t.parent ? (
          <span className="text-sm text-muted-foreground">
            in <Link href={`/admin/territories/${t.parent.id}`} className="underline">{t.parent.name}</Link>
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground">Manager: {t.manager?.name ?? "—"}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users in this territory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="member-list">
            {t.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link href={`/admin/users/${m.userId}`} className="font-medium text-primary hover:underline">
                  {m.user.name}
                </Link>
                <span className="text-muted-foreground">{m.user.role.name}</span>
                {m.isManager ? <span className="text-xs font-semibold">manager</span> : null}
                {!m.user.active ? <span className="text-xs text-red-600">inactive</span> : null}
                <ActionForm action={removeMemberAction} className="ml-auto" confirm={`Remove ${m.user.name} from ${t.name}?`}>
                  <input type="hidden" name="territoryId" value={t.id} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <Button size="sm" variant="ghost" type="submit">
                    Remove
                  </Button>
                </ActionForm>
              </li>
            ))}
            {t.members.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No members</li> : null}
          </ul>
          <ActionForm action={addMemberAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="territoryId" value={t.id} />
            <Select name="userId" required aria-label="User to add" className="w-64">
              <option value="">Add user…</option>
              {lookups.activeUsers
                .filter((u) => !memberIds.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="isManager" /> manager
            </label>
            <SubmitButton size="sm">Add</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      {t.level > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Records &amp; deletion</CardTitle>
            <CardDescription>
              {recordTotal} record(s) reference this territory (including soft-deleted). A territory with records cannot be
              deleted – move them first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            {recordTotal > 0 ? (
              <ActionForm
                action={moveRecordsAction}
                className="flex items-center gap-2"
                confirm="Move all records of this territory? Their brand/region change to the target's."
              >
                <input type="hidden" name="territoryId" value={t.id} />
                <Select name="targetId" required aria-label="Target territory" className="w-64">
                  <option value="">Move records to…</option>
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <SubmitButton size="sm" variant="outline">
                  Move
                </SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={deleteTerritoryAction} confirm={`Delete territory ${t.name}?`}>
              <input type="hidden" name="territoryId" value={t.id} />
              <Button size="sm" variant="destructive" type="submit" disabled={recordTotal > 0 || t.children.length > 0}>
                Delete territory
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
