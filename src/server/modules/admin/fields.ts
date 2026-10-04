import { Prisma } from "@prisma/client";
import { getModule, type ModuleKey } from "@/server/access/modules";

/** Fields of modules whose models arrive in later prompts (so field security can be configured now). */
const PLANNED_FIELDS: Partial<Record<ModuleKey, string[]>> = {
  leads: ["name", "phone", "email", "source", "model", "status"],
  accounts: ["name", "city", "phone", "email", "address", "kycNumber", "creditLimit"],
  contacts: ["name", "city", "phone", "mobile", "email", "address"],
  products: ["name", "model", "variant", "listPrice"],
  priceBooks: ["name", "currency"],
  quotes: ["number", "amount", "discount", "validUntil"],
  salesOrders: ["number", "amount", "vin"],
  invoices: ["number", "amount", "dueDate"],
  activities: ["subject", "dueDate", "status"],
  cases: ["subject", "status", "priority"],
  campaigns: ["name", "budget", "status"],
};

const SYSTEM_FIELDS = new Set([
  "id",
  "brandId",
  "regionId",
  "territoryId",
  "ownerId",
  "createdById",
  "updatedById",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);

/** Configurable fields for a module: schema scalars (when the model exists) + planned + already configured. */
export function moduleFields(module: ModuleKey, configured: string[] = []): string[] {
  const def = getModule(module);
  const model = def?.model ? Prisma.dmmf.datamodel.models.find((m) => m.name === def.model) : undefined;
  const fromSchema = model
    ? model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name)
    : [];
  return [...new Set([...fromSchema, ...(PLANNED_FIELDS[module] ?? []), ...configured])].filter(
    (f) => !SYSTEM_FIELDS.has(f),
  );
}
