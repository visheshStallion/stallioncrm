import Link from "next/link";
import { forbidden } from "next/navigation";
import type { ReactNode } from "react";
import { hasPermission } from "@/server/access/can";
import { canSeeCost, isSalesView } from "@/server/modules/inventory/queries";
import { requireContext } from "@/server/request";

/** Inventory section (prompt 16). The tabs follow the role: sales users only get the stock they can sell. */
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "inventory", "read")) forbidden();
  const sales = isSalesView(ctx);
  const tabs = sales
    ? [
        { href: "/inventory", label: "Overview" },
        { href: "/inventory/units", label: "Available to sell" },
        { href: "/inventory/units?view=mine", label: "My reserved units" },
      ]
    : [
        { href: "/inventory", label: "Dashboard" },
        { href: "/inventory/units", label: "Vehicles" },
        { href: "/inventory/parts", label: "Parts & accessories" },
        { href: "/inventory/documents", label: "Documents" },
        ...(canSeeCost(ctx) ? [{ href: "/inventory/journals", label: "Journals" }] : []),
        { href: "/inventory/reports", label: "Reports" },
        { href: "/inventory/scan", label: "Scan" },
        { href: "/inventory/settings", label: "Settings" },
      ];
  return (
    <div>
      <nav className="mb-3 flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Inventory sections" data-testid="inventory-nav">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-md px-3 py-1.5 text-[13px] font-medium text-text hover:bg-muted">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
