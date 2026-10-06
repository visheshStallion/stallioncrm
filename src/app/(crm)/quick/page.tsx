import Link from "next/link";
import { PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { QuickActions } from "@/components/pwa/QuickActions";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Quick actions" };

/** Field quick actions (log a call, add a note, new lead) – they also work without a connection. */
export default async function QuickPage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  return (
    <div>
      <PageTitleRow title="Quick actions" />
      <nav aria-label="New documents" className="mb-3 flex flex-wrap gap-2" data-testid="quick-documents">
        {([["quotes", "/quotes/new", "New quote"], ["salesOrders", "/salesOrders/new", "New sales order"], ["invoices", "/invoices/new", "New invoice"]] as const)
          .filter(([m]) => hasPermission(ctx, m, "create"))
          .map(([m, href, label]) => (
            <Link key={m} href={href} className="crm-btn crm-btn-secondary">
              {label}
            </Link>
          ))}
        <span className="self-center text-xs text-text-muted">Online only</span>
      </nav>
      <QuickActions brands={dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code }))} regions={dir.myRegions.map((r) => ({ id: r.id, name: r.name }))} />
    </div>
  );
}
