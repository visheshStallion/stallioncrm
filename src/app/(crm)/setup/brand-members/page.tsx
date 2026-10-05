import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addBrandMemberAction, removeBrandMemberAction, setBrandMemberManagerAction } from "@/server/modules/setup/actions";
import { brandTeam, brandsInSetupScope } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Brand team" };

/** Territory membership of one brand. A Brand Admin sees and changes the own brand(s) only. */
export default async function BrandMembersPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { ctx, entry } = await requireSetup("brand-members"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const brands = await brandsInSetupScope(ctx, "brand-members");
  if (!brands.length) notFound();
  const brand = sp.brand ? brands.find((b) => b.id === sp.brand) : brands[0];
  if (!brand) notFound(); // a brand outside the user's Setup scope does not exist for them
  const territories = await brandTeam(ctx, brand.id);
  return (
    <div>
      <SetupHeader entry={entry} />
      {brands.length > 1 ? (
        <form method="get" className="mb-4 flex items-end gap-2">
          <Select name="brand" defaultValue={brand.id} aria-label="Brand" className="w-64">
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} – {b.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      ) : null}
      <p className="mb-3 flex items-center gap-2 text-sm" data-testid="brand-team-brand">
        <BrandBadge brand={brand} size="lg" /> {brand.name}
      </p>
      {territories.map((t) => (
        <Section key={t.id} title={`${t.name}${t.regionId ? "" : " – whole brand"}`} testId="brand-territory">
          {t.members.length === 0 ? <p className="text-text-muted">Nobody yet.</p> : null}
          <ul className="divide-y divide-border">
            {t.members.map((m) => (
              <li key={m.user.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="brand-member">
                <span className="font-bold">{m.user.name}</span>
                <span className="text-text-muted">
                  {m.user.email} · {m.user.role.name}
                </span>
                {m.isManager ? <StatusPill tone="primary">Manager</StatusPill> : null}
                {m.user.active ? null : <StatusPill>Inactive</StatusPill>}
                <div className="ml-auto flex gap-1">
                  <ActionForm action={setBrandMemberManagerAction}>
                    <input type="hidden" name="territoryId" value={t.id} />
                    <input type="hidden" name="userId" value={m.user.id} />
                    <input type="hidden" name="isManager" value={(!m.isManager).toString()} />
                    <Button size="sm" variant="ghost" type="submit">
                      {m.isManager ? "Not a manager" : "Make manager"}
                    </Button>
                  </ActionForm>
                  <ActionForm action={removeBrandMemberAction} confirm={`Remove ${m.user.name} from ${t.name}? They lose access to its records.`}>
                    <input type="hidden" name="territoryId" value={t.id} />
                    <input type="hidden" name="userId" value={m.user.id} />
                    <Button size="sm" variant="ghost" type="submit">
                      Remove
                    </Button>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
          <ActionForm action={addBrandMemberAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="territoryId" value={t.id} />
            <Input name="email" type="email" required placeholder="E-mail of an existing user" className="w-72" aria-label={`E-mail of the user to add to ${t.name}`} />
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="isManager" /> Manager
            </label>
            <SubmitButton size="sm" variant="outline">
              Add to territory
            </SubmitButton>
          </ActionForm>
        </Section>
      ))}
    </div>
  );
}
