import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { designerCatalogue, letterheadBrands } from "@/server/modules/print/service";
import { setupBrandIds } from "@/server/modules/setup/access";
import { requireSetup } from "../../guard";
import { Section, SetupHeader } from "../../_components";
import { Designer } from "../Designer";

export const metadata = { title: "New print template" };

export default async function NewPrintTemplatePage({ searchParams }: { searchParams: Promise<{ module?: string; brand?: string }> }) {
  const { ctx, entry } = await requireSetup("print-templates"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const sp = await searchParams;
  const brands = await letterheadBrands(ctx).catch(() => []);
  const allBrandsAllowed = setupBrandIds(ctx) === null;
  const mod = PRINT_MODULE_OPTIONS.find((m) => m.key === sp.module);
  const brand = sp.brand && sp.brand !== "all" ? brands.find((b) => b.id === sp.brand) : null;
  const ready = !!mod && (sp.brand === "all" ? allBrandsAllowed : !!brand);

  return (
    <div>
      <SetupHeader entry={{ ...entry, label: "New print template", description: "Choose the module and the brand, then lay out the blocks" }} />
      <Section title="Module and brand">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="module">Module</Label>
            <Select id="module" name="module" defaultValue={sp.module ?? "deals"} className="w-56">
              {PRINT_MODULE_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand">Brand</Label>
            <Select id="brand" name="brand" defaultValue={sp.brand ?? (allBrandsAllowed ? "all" : brands[0]?.id)} className="w-64">
              {allBrandsAllowed ? <option value="all">All brands</option> : null}
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant={ready ? "outline" : "default"}>
            {ready ? "Change" : "Start designing"}
          </Button>
        </form>
      </Section>
      {ready && mod ? <NewDesigner moduleKey={mod.key} moduleLabel={mod.label} brandId={brand?.id ?? null} brandLabel={brand ? `${brand.code} – ${brand.name}` : "All brands"} isAdmin={ctx.isAdmin} /> : null}
    </div>
  );
}

async function NewDesigner({ moduleKey, moduleLabel, brandId, brandLabel, isAdmin }: { moduleKey: string; moduleLabel: string; brandId: string | null; brandLabel: string; isAdmin: boolean }) {
  const { ctx } = await requireSetup("print-templates");
  const cat = await designerCatalogue(ctx, moduleKey);
  return (
    <Designer
      key={`${moduleKey}:${brandId}`}
      templateId={null}
      module={moduleKey}
      moduleLabel={moduleLabel}
      brandId={brandId}
      brandLabel={brandLabel}
      initial={{ name: `${moduleLabel} – ${brandId ? brandLabel.split(" – ")[0] : "all brands"}`, paper: "A4", orientation: "portrait", layout: cat.starter }}
      catalogue={{ sampleId: cat.sampleId, sampleTitle: cat.sampleTitle, fields: cat.fields, lists: cat.lists, hasLines: cat.hasLines, mergeFields: cat.mergeFields }}
      canEdit
      isAdmin={isAdmin}
    />
  );
}
