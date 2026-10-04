import { AppShell } from "@/components/crm/AppShell";
import { requireContext } from "@/server/request";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
