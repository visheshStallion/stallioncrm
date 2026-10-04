import type { ReactNode } from "react";
import { logoutAction } from "@/app/(crm)/actions";
import { hasPermission } from "@/server/access/can";
import { isModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { overdueCount } from "@/server/modules/activities/queries";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { myNotifications } from "@/server/modules/notifications/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters } from "@/server/request";
import { BrandSwitcher } from "./BrandSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ModuleRail } from "./ModuleRail";
import { DEFAULT_PINNED, QUICK_CREATE, RAIL_ORDER } from "./nav-config";
import { QuickCreateMenu } from "./QuickCreate";
import { AvatarMenu, CalendarShortcut, NotificationsBell, SetupGear } from "./UserMenus";

/**
 * Authenticated app shell (prompt 17 §2): dark module rail + 52 px top bar (brand switcher, region filter,
 * search, quick create, notifications, calendar, setup gear for admins, avatar menu). Everything shown is
 * derived from the access context – modules the profile cannot read never appear.
 */
export async function AppShell({ ctx, children }: { ctx: AccessContext; children: ReactNode }) {
  const canRead = (key: string) => key === "home" || (isModuleKey(key) && hasPermission(ctx, key, "read"));
  const [dir, filters, prefs, notifications, overdue] = await Promise.all([
    getDirectory(ctx),
    getUiFilters(ctx),
    getPreferences(ctx),
    myNotifications(ctx),
    canRead("activities") ? overdueCount(ctx) : 0,
  ]);
  // Overdue badge on the Activities rail item.
  const railItems = RAIL_ORDER.filter((i) => canRead(i.key)).map((i) => (i.key === "activities" && overdue > 0 ? { ...i, badge: overdue } : i));
  const quickCreate = QUICK_CREATE.filter((q) => isModuleKey(q.module) && hasPermission(ctx, q.module, "create"));
  const lookups = quickCreate.length ? await leadFormLookups(ctx) : null;

  const selectedBrand = filters.brandId ? dir.brands.find((b) => b.id === filters.brandId) : null;
  const railBrand = selectedBrand
    ? { id: selectedBrand.id, code: selectedBrand.code, name: selectedBrand.name, color: selectedBrand.color, hasLogo: false }
    : null;

  return (
    <div className="flex min-h-screen bg-canvas">
      <ModuleRail
        items={railItems}
        brand={railBrand}
        prefs={prefs.rail ?? { order: RAIL_ORDER.map((i) => i.key), pinned: DEFAULT_PINNED, collapsed: false }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-border bg-surface px-4" data-testid="top-bar">
          <BrandSwitcher
            brands={dir.myBrands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
            regions={dir.myRegions.map((r) => ({ id: r.id, label: r.name }))}
            brandId={filters.brandId ?? null}
            regionId={filters.regionId ?? null}
          />
          <div className="flex flex-1 justify-center">
            <GlobalSearch brands={dir.brands.map((b) => ({ id: b.id, code: b.code, color: b.color }))} />
          </div>
          <div className="flex items-center gap-1">
            {lookups ? (
              <QuickCreateMenu
                items={quickCreate}
                lookups={{ brands: lookups.brands, regions: lookups.regions, defaultBrandId: lookups.defaultBrandId, defaultRegionId: lookups.defaultRegionId }}
              />
            ) : null}
            <NotificationsBell count={notifications.unread} items={notifications.rows} />
            <CalendarShortcut />
            {ctx.isAdmin ? <SetupGear /> : null}
            <AvatarMenu
              user={{ ...ctx.user, profileName: ctx.profile.name }}
              prefs={{ theme: prefs.theme, density: prefs.density, dateFormat: prefs.dateFormat }}
              logout={logoutAction}
            />
          </div>
        </header>
        <main className="flex-1 p-5">{children}</main>
      </div>
      <KeyboardShortcuts />
    </div>
  );
}
