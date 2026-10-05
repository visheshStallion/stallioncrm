import type { HubQuery } from "@/server/modules/templates/hub";
import { HubView } from "../../templates/HubView";
import { requireSetup } from "../guard";
import { SetupHeader } from "../_components";

export const metadata = { title: "Templates" };

/** The templates hub inside Setup → Customization (the same hub as /templates). */
export default async function SetupTemplatesPage({ searchParams }: { searchParams: Promise<HubQuery> }) {
  const { ctx, entry } = await requireSetup("templates-hub"); // setupPermission: ADMIN, BRAND_ADMIN
  return (
    <div>
      <SetupHeader entry={entry} />
      <HubView ctx={ctx} query={await searchParams} basePath="/setup/templates" />
    </div>
  );
}
