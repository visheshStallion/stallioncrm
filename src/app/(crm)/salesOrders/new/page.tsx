import { NewDocumentPage } from "../../_documents/pages";

export const metadata = { title: "New document" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NewDocumentPage type="salesOrder" searchParams={searchParams} />;
}
