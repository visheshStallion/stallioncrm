import { notFound } from "next/navigation";
import { SetupLayout } from "@/components/crm/SetupLayout";
import { requireContext } from "@/server/request";
import { SETUP_CATEGORIES } from "./setup-categories";

/** Setup (Administrator profile only); everyone else gets 404 – the area is not revealed. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (!ctx.isAdmin) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold">Setup</h1>
      <SetupLayout categories={SETUP_CATEGORIES}>{children}</SetupLayout>
    </div>
  );
}
