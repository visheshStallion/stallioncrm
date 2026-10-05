import { PageTitleRow } from "@/components/crm/primitives";
import type { HubQuery } from "@/server/modules/templates/hub";
import { requireContext } from "@/server/request";
import { HubView } from "./HubView";

export const metadata = { title: "Templates" };

/** Templates hub for every user: e-mail, document / print, record, SMS and WhatsApp templates of the modules they can open. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<HubQuery> }) {
  const ctx = await requireContext();
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitleRow title="Templates" />
      <HubView ctx={ctx} query={await searchParams} basePath="/templates" />
    </div>
  );
}
