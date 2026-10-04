import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createRegionAction, renameRegionAction, setRegionActiveAction } from "@/server/modules/admin/actions";
import { listRegions } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Regions" };

export default async function RegionsPage() {
  const ctx = await requireContext();
  const regions = await listRegions(ctx);
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {regions.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="region-row">
              <ActionForm action={renameRegionAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={r.id} />
                <Input name="name" defaultValue={r.name} className="w-56" aria-label={`Name of ${r.name}`} />
                <SubmitButton size="sm" variant="outline">
                  Rename
                </SubmitButton>
              </ActionForm>
              <Badge className={r.active ? "text-emerald-700" : "text-muted-foreground"}>
                {r.active ? "Active" : "Inactive"}
              </Badge>
              <span className="text-xs text-muted-foreground">{r._count.territories} territories</span>
              <ActionForm
                action={setRegionActiveAction}
                className="ml-auto"
                confirm={r.active ? `Deactivate ${r.name}? New brands will not get a ${r.name} territory.` : undefined}
              >
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="active" value={(!r.active).toString()} />
                <Button size="sm" variant="ghost" type="submit">
                  {r.active ? "Deactivate" : "Activate"}
                </Button>
              </ActionForm>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add region</CardTitle>
          <CardDescription>Adds a “BRAND – Region” territory under every brand.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRegionAction} className="flex gap-2">
            <Input name="name" placeholder="Region name" className="w-64" required />
            <SubmitButton>Add region</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
