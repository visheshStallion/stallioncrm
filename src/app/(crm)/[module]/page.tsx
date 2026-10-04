import { forbidden, notFound } from "next/navigation";
import { EmptyState, PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { getModule, isModuleKey } from "@/server/access/modules";
import { requireContext } from "@/server/request";

/** Placeholder for modules whose build prompt has not run yet (implemented modules have their own routes). */
export default async function ModulePlaceholderPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!isModuleKey(module)) notFound();
  const ctx = await requireContext();
  if (!hasPermission(ctx, module, "read")) forbidden();
  const def = getModule(module)!;
  return (
    <div>
      <PageTitleRow title={def.label} />
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState title={`${def.label} is coming soon`} text={`This module is built in prompt ${def.prompt}.`} />
      </div>
    </div>
  );
}
