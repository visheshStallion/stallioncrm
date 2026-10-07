import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ImportSteps } from "@/components/crm/ImportSteps";
import { uploadImportAction } from "@/server/modules/imports/actions";
import { MAX_IMPORT_ROWS } from "@/server/modules/imports/plan";
import { MAX_IMPORT_BYTES, canImport } from "@/server/modules/imports/service";
import { requireContext } from "@/server/request";
import { UploadZone } from "./UploadZone";

export const metadata = { title: "Import Price Books" };

/**
 * Import Price Books – step 1 (Upload). The next steps (actions, column and field mapping, dry run, assign) run in the
 * import wizard: rows create the price books by name and set the product prices of the brand.
 */
export default async function ImportPriceBooksPage() {
  const ctx = await requireContext();
  if (!canImport(ctx)) forbidden();
  return (
    <div>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <h1>Import Price Books</h1>
        <ImportSteps current={0} />
        <Link href="/imports" className="text-[13px] text-primary underline">
          Import history
        </Link>
      </div>
      <div className="mx-auto max-w-2xl space-y-4">
        <ActionForm action={uploadImportAction}>
          <input type="hidden" name="module" value="priceBooks" />
          <UploadZone module="priceBooks" />
        </ActionForm>
        <ul className="list-disc space-y-1 rounded-lg border border-warning/40 bg-warning/10 py-3 pl-8 pr-4 text-[13px]" data-testid="import-limits">
          <li>
            The file can be at most {Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB. You can import at most {MAX_IMPORT_ROWS.toLocaleString("en-NG")} rows into the Price Books module at a time.
          </li>
          <li>You can upload one file at a time.</li>
          <li>Columns: price book name, product code, price, max discount % and brand. A price book that does not exist yet is created; existing prices are updated.</li>
        </ul>
        <p className="text-[13px] text-text-muted">
          Nothing is written until you have checked the dry run. Previous imports:{" "}
          <Link href="/imports" className="text-primary underline">
            Import history
          </Link>
        </p>
      </div>
    </div>
  );
}
