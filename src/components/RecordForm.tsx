import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FieldAccess } from "@/server/access/types";

export interface RecordField {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  value?: string | number | null;
  /** Rendered instead of the raw value in read-only mode, for example a badge. */
  display?: ReactNode;
  options?: Array<{ value: string; label: string }>;
  /** From fieldAccess(): hidden fields are not rendered; masked and read fields are read-only. */
  access?: FieldAccess;
  required?: boolean;
}

/**
 * Generic record form. `readOnly` renders a detail view; otherwise a form posting to `action`.
 * Field-level permissions are respected via `access`.
 */
export function RecordForm({
  fields,
  readOnly = false,
  action,
  submitLabel = "Save",
}: {
  fields: RecordField[];
  readOnly?: boolean;
  action?: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
}) {
  const visible = fields.filter((f) => f.access !== "hidden");
  if (readOnly || !action) {
    return (
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {visible.map((f) => (
          <div key={f.name}>
            <dt className="text-xs font-medium uppercase text-muted-foreground">{f.label}</dt>
            <dd className="mt-1 text-sm" data-field={f.name}>
              {f.display ?? (f.value === null || f.value === undefined || f.value === "" ? "—" : String(f.value))}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {visible.map((f) => {
        const disabled = f.access === "read" || f.access === "masked";
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <Label htmlFor={f.name}>{f.label}</Label>
            {f.type === "select" ? (
              <Select
                id={f.name}
                name={f.name}
                defaultValue={f.value?.toString() ?? ""}
                disabled={disabled}
                required={f.required}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={f.name}
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={f.value?.toString() ?? ""}
                disabled={disabled}
                required={f.required}
              />
            )}
          </div>
        );
      })}
      <div className="sm:col-span-2">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
