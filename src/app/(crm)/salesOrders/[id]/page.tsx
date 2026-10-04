import { DocumentDetailPage } from "../../_documents/pages";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentDetailPage type="salesOrder" params={params} />;
}
