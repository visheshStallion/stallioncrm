import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { RegionBadge } from "@/components/RegionBadge";
import { Card, CardContent } from "@/components/ui/card";
import { getModule } from "@/server/access/modules";
import { getDirectory } from "@/server/modules/org/queries";
import { globalSearch } from "@/server/modules/search/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const ctx = await requireContext();
  const [hits, dir] = await Promise.all([globalSearch(ctx, q), getDirectory(ctx)]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Search</h1>
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="At least 2 characters"
          className="h-9 w-80 rounded-md border border-border bg-background px-3 text-sm"
          aria-label="Search query"
        />
      </form>
      {q.trim().length >= 2 ? (
        <Card>
          <CardContent className="divide-y divide-border p-0" data-testid="search-results">
            {hits.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No results in your scope.</p>
            ) : (
              hits.map((h) => (
                <Link
                  key={`${h.module}:${h.id}`}
                  href={h.href}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50"
                  data-testid="search-hit"
                >
                  <span className="w-16 text-xs uppercase text-muted-foreground">{getModule(h.module)?.label}</span>
                  <BrandBadge brand={dir.brands.find((b) => b.id === h.brandId)} />
                  <span className="font-medium">{h.title}</span>
                  <span className="text-sm text-muted-foreground">{h.subtitle}</span>
                  <RegionBadge region={dir.regions.find((r) => r.id === h.regionId)} className="ml-auto" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
