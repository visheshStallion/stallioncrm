import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/(crm)/actions";
import { hasPermission } from "@/server/access/can";
import { isModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { overdueCount } from "@/server/modules/activities/queries";
import { pendingApprovalCount } from "@/server/modules/approvals/service";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { myNotifications } from "@/server/modules/notifications/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { hasSetupArea } from "@/server/modules/setup/access";
import { getUiFilters } from "@/server/request";
import { MobileNav } from "@/components/pwa/MobileNav";
import { PwaClient } from "@/components/pwa/PwaClient";
import { BrandLogoStrip } from "@/components/BrandLogo";
import { BrandSwitcher } from "./BrandSwitcher";
import { ClassicNav } from "./ClassicNav";
import { GlobalSearch } from "./GlobalSearch";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ModuleRail } from "./ModuleRail";
import { DEFAULT_PINNED, QUICK_CREATE, RAIL_ORDER } from "./nav-config";
import { QuickCreateMenu } from "./QuickCreate";
import { AvatarMenu, CalendarShortcut, NotificationsBell, SetupGear } from "./UserMenus";

/**
 * Authenticated app shell: header (logo, brand logos and switcher, search, quick create, calendar, notifications,
 * setup gear for admins, avatar menu) and the modules either in the dark sidebar or – classic mode – as tabs
 * under the header (user preference `nav`). Everything shown is derived from the access context – modules the
 * profile cannot read never appear.
 */
export async function AppShell({ ctx, children }: { ctx: AccessContext; children: ReactNode }) {
  // Home and the approvals inbox are personal pages – available to every profile.
  const canRead = (key: string) => key === "home" || key === "approvals" || (isModuleKey(key) && hasPermission(ctx, key, "read"));
  const [dir, filters, prefs, notifications, overdue, approvals] = await Promise.all([
    getDirectory(ctx),
    getUiFilters(ctx),
    getPreferences(ctx),
    myNotifications(ctx),
    hasPermission(ctx, "activities", "read") ? overdueCount(ctx) : 0,
    pendingApprovalCount(ctx),
  ]);
  // Overdue badge on the Activities rail item.
  const railItems = RAIL_ORDER.filter((i) => canRead(i.key)).map((i) => (i.key === "activities" && overdue > 0 ? { ...i, badge: overdue } : i.key === "approvals" && approvals > 0 ? { ...i, badge: approvals } : i));
  const quickCreate = QUICK_CREATE.filter((q) => isModuleKey(q.module) && hasPermission(ctx, q.module, "create"));
  const lookups = quickCreate.length ? await leadFormLookups(ctx) : null;

  const selectedBrand = filters.brandId ? dir.brands.find((b) => b.id === filters.brandId) : null;
  // the logo(s) of the signed-in user's brands on every page: the selected brand, else all of the user's brands
  const logoBrands = selectedBrand ? [selectedBrand] : [...dir.myBrands].sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"));
  const railBrand = logoBrands.length === 1 ? logoBrands[0]! : null;

  const railPrefs = prefs.rail ?? { order: RAIL_ORDER.map((i) => i.key), pinned: DEFAULT_PINNED, collapsed: true };
  const classic = prefs.nav === "classic";

  return (
    <div className="flex min-h-screen bg-canvas" data-nav={prefs.nav}>
      {classic ? null : <ModuleRail items={railItems} brand={railBrand} prefs={railPrefs} isAdmin={hasSetupArea(ctx)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="crm-header" data-testid="top-bar">
          {classic ? (
            <Link href="/" className="crm-logo hidden md:inline-flex">
              <span className="crm-logo-mark">SC</span>
              <span className="hidden lg:inline">StallionCRM</span>
            </Link>
          ) : null}
          <BrandLogoStrip brands={logoBrands} />
          <BrandSwitcher
            brands={dir.myBrands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
            regions={dir.myRegions.map((r) => ({ id: r.id, label: r.name }))}
            brandId={filters.brandId ?? null}
            regionId={filters.regionId ?? null}
          />
          <div className="hidden min-w-0 md:block">
            <GlobalSearch brands={dir.brands.map((b) => ({ id: b.id, code: b.code, color: b.color }))} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            {lookups ? (
              <QuickCreateMenu
                items={quickCreate}
                lookups={{ brands: lookups.brands, regions: lookups.regions, defaultBrandId: lookups.defaultBrandId, defaultRegionId: lookups.defaultRegionId }}
              />
            ) : null}
            <span className="hidden md:contents">
              <CalendarShortcut />
            </span>
            <NotificationsBell count={notifications.unread} items={notifications.rows} />
            <span className="hidden md:contents">{hasSetupArea(ctx) ? <SetupGear /> : null}</span>
            <AvatarMenu
              user={{ ...ctx.user, profileName: ctx.profile.name }}
              prefs={{ theme: prefs.theme, density: prefs.density, dateFormat: prefs.dateFormat, nav: prefs.nav }}
              logout={logoutAction}
            />
          </div>
        </header>
        {classic ? <ClassicNav items={railItems} prefs={railPrefs} /> : null}
        <PwaClient />
        <main className="crm-main pb-20 md:pb-4">{children}</main>
      </div>
      <MobileNav items={railItems} unread={notifications.unread} />
      <KeyboardShortcuts />
    </div>
  );
}
