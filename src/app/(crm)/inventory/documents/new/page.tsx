import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { PageTitleRow } from "@/components/crm/primitives";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { INV_DOCS, isDocType } from "@/server/modules/inventory/config";
import { canSeeCost } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { DocEditor } from "../DocEditor";
import { editorLookups, newValues } from "../lookups";

export const metadata = { title: "New inventory document" };

/** New inventory document for ONE brand (`?brand=`; the brand switcher's brand, or the user's only brand). */
export default async function NewInvDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string; brand?: string; parent?: string }> }) {
  const sp = await searchParams;
  if (!sp.type || !isDocType(sp.type)) notFound();
  const cfg = INV_DOCS[sp.type];
  if (cfg.system) notFound();
  const ctx = await requireContext();
  if (!hasPermission(ctx, cfg.area, "create")) forbidden();
  const [dir, ui] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE");
  const brand = brands.find((b) => b.code === sp.brand) ?? brands.find((b) => b.id === ui.brandId) ?? (brands.length === 1 ? brands[0] : undefined);
  const qs = (code: string) => `/inventory/documents/new?type=${cfg.type}&brand=${code}${sp.parent ? `&parent=${sp.parent}` : ""}`;
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <PageTitleRow title={`New ${cfg.label.toLowerCase()}`} left={<span className="text-[13px] text-text-muted">{brand ? brand.name : "choose the brand"}</span>} />
      {brands.length > 1 ? (
        <nav className="flex flex-wrap gap-1" aria-label="Brand of the document" data-testid="doc-brand">
          {brands.map((b) => (
            <Link key={b.id} href={qs(b.code)} className={cn("rounded-full border px-3 py-1 text-[13px]", b.id === brand?.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted")}>
              {b.code}
            </Link>
          ))}
        </nav>
      ) : null}
      {brand ? (
        <DocEditor key={`${brand.id}:${sp.parent ?? ""}`} cfg={cfg} brandId={brand.id} lookups={await editorLookups(ctx, cfg, brand.id)} values={await newValues(ctx, cfg, brand.id, sp.parent)} showCost={canSeeCost(ctx)} cancelHref={`/inventory/documents?type=${cfg.type}`} />
      ) : (
        <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">Every inventory document belongs to one brand (one legal entity). Choose the brand above.</p>
      )}
    </div>
  );
}
