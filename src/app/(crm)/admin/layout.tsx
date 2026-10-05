import { notFound } from "next/navigation";
import { SetupLayout } from "@/components/crm/SetupLayout";
import { visibleCatalogue } from "@/server/modules/setup/access";
import { requireContext } from "@/server/request";

/**
 * The administration pages of prompts 01–15, now part of Setup (catalogue in src/server/modules/setup/catalogue.ts):
 * Administrator profile only; everyone else gets 404 – the area is not revealed. Each service checks again.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (!ctx.isAdmin) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Setup</h1>
      <SetupLayout categories={visibleCatalogue(ctx)}>{children}</SetupLayout>
    </div>
  );
}
