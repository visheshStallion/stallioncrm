import { SetupLayout } from "@/components/crm/SetupLayout";
import { visibleCatalogue } from "@/server/modules/setup/access";
import { requireContext } from "@/server/request";

/**
 * Setup area. The navigation lists only the functions the signed-in user may open (tier of the catalogue entry);
 * every page checks its own entry again with requireSetup – a function that is not for the user answers 404.
 */
export default async function SetupAreaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return <SetupLayout categories={visibleCatalogue(ctx)}>{children}</SetupLayout>;
}
