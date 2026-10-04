import { DocumentListPage } from "../_documents/pages";

export const metadata = { title: "Invoices" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DocumentListPage type="invoice" searchParams={searchParams} />;
}
