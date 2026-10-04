import { LogOut, Search } from "lucide-react";
import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasPermission } from "@/server/access/can";
import { MODULES } from "@/server/access/modules";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { logoutAction } from "./actions";
import { FilterBar } from "./FilterBar";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [dir, filters] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const nav = MODULES.filter((m) => m.nav && hasPermission(ctx, m.key, "read"));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <Link href="/" className="flex h-14 items-center gap-2 border-b border-border px-4 font-bold text-primary">
          <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">SC</span>
          StallionCRM
        </Link>
        <nav className="flex-1 space-y-0.5 p-2 text-sm" aria-label="Modules" data-testid="module-nav">
          <Link href="/" className="block rounded-md px-3 py-1.5 hover:bg-muted">
            Home
          </Link>
          {nav.map((m) => (
            <Link key={m.key} href={`/${m.key}`} className="block rounded-md px-3 py-1.5 hover:bg-muted">
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          {ctx.profile.name} profile
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <form action="/search" className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input name="q" placeholder="Search…" className="pl-8" aria-label="Global search" />
          </form>
          <FilterBar
            brands={dir.myBrands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
            regions={dir.myRegions.map((r) => ({ id: r.id, label: r.name }))}
            brandId={filters.brandId ?? null}
            regionId={filters.regionId ?? null}
          />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden gap-1 lg:flex">
              {dir.myBrands.filter((b) => b.status === "ACTIVE").slice(0, 5).map((b) => (
                <BrandBadge key={b.id} brand={b} />
              ))}
            </div>
            <div className="text-right text-sm leading-tight">
              <div className="font-medium" data-testid="current-user">
                {ctx.user.name}
              </div>
              <div className="text-xs text-muted-foreground">{ctx.user.roleName}</div>
            </div>
            <form action={logoutAction}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
