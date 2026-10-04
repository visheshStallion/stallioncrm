import { PageTitleRow } from "@/components/crm/primitives";
import { requireContext } from "@/server/request";
import { Scanner } from "./Scanner";

export const metadata = { title: "Scan VIN" };

/** Mobile-friendly VIN lookup for the yard: camera scan or typed VIN, own brands only. */
export default async function ScanPage() {
  await requireContext();
  return (
    <div>
      <PageTitleRow title="Scan a VIN" />
      <Scanner />
    </div>
  );
}
