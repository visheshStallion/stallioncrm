import { redirect } from "next/navigation";

/** The list of purchase orders is the inventory documents list filtered to POs. */
export default function PurchaseOrdersPage() {
  redirect("/inventory/documents?type=PO");
}
