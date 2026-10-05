import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compareProfiles, profilesForSetup } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Compare Profiles" };

export default async function CompareProfilesPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { ctx, entry } = await requireSetup("profiles-compare"); // setupPermission: ADMIN
  const sp = await searchParams;
  const profiles = await profilesForSetup(ctx, "profiles-compare");
  const result = sp.a && sp.b && sp.a !== sp.b ? await compareProfiles(ctx, sp.a, sp.b) : null;
  const pick = (name: "a" | "b", label: string) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} defaultValue={sp[name] ?? ""} required className="w-64">
        <option value="">Choose…</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.users} users)
          </option>
        ))}
      </Select>
    </div>
  );
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Profiles to compare">
        <form className="flex flex-wrap items-end gap-3" method="get">
          {pick("a", "First profile")}
          {pick("b", "Second profile")}
          <Button type="submit">Compare</Button>
        </form>
      </Section>
      {result ? (
        <Section title={`${result.differences.length} difference(s) – ${result.same} settings are the same`} testId="profile-differences">
          {result.differences.length === 0 ? (
            <p className="text-text-muted">The two profiles grant exactly the same.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Area</TableHead>
                  <TableHead>Setting</TableHead>
                  <TableHead>{result.a}</TableHead>
                  <TableHead>{result.b}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.differences.map((d) => (
                  <TableRow key={`${d.area}:${d.item}`}>
                    <TableCell className="text-text-muted">{d.area}</TableCell>
                    <TableCell>{d.item}</TableCell>
                    <TableCell>{d.a}</TableCell>
                    <TableCell>{d.b}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}
    </div>
  );
}
