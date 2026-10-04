import { DocumentListPage } from "../_documents/pages";

export const metadata = { title: "Sales Orders" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DocumentListPage type="salesOrder" searchParams={searchParams} />;
}
