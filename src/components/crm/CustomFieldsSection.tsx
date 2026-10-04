import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import { delegateName } from "@/server/access/brand-owned";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import type { CustomModule } from "@/server/modules/customization/engine";
import { presentCustomFields } from "@/server/modules/customization/service";
import { Field, FieldSection } from "./record";

const MODEL: Record<CustomModule, string> = { leads: "Lead", deals: "Deal", accounts: "Account", contacts: "Contact", cases: "Case" };

/**
 * Custom fields of a record on its detail page: the fields that apply to the record's brand and that the
 * viewer's profile may see (hidden fields are omitted, masked ones shown as ****), formulas computed.
 */
export async function CustomFieldsSection({ ctx, module, id, dateFormat }: { ctx: AccessContext; module: CustomModule; id: string; dateFormat: DateFormat }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over the modules with custom fields
  const record = (await (scopedDb(ctx) as any)[delegateName(MODEL[module])].findFirst({ where: { id } })) as Record<string, unknown> | null;
  if (!record) return null;
  const fields = await presentCustomFields(ctx, module, (record.brandId as string | undefined) ?? null, record);
  if (fields.length === 0) return null;
  const display = (f: (typeof fields)[number]) => {
    const v = f.value;
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    if (f.masked) return "****";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.join(", ");
    if (f.type === "CURRENCY") return formatMoney(Number(v));
    if (f.type === "DATE") return formatDate(String(v), dateFormat, "UTC");
    return String(v);
  };
  return (
    <FieldSection title="Additional Information" id="custom-fields">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} value={display(f)} masked={f.masked} />
      ))}
    </FieldSection>
  );
}
