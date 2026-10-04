import { DocumentListPage } from "../_documents/pages";

export const metadata = { title: "Quotes" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DocumentListPage type="quote" searchParams={searchParams} />;
}
