/**
 * Soft delete through the REST API (prompt 13): `DELETE /api/v1/<module>/<id>`. Needs the profile's delete
 * permission and access to the record; records outside the caller's scope are 404. Nothing is physically
 * removed – `deletedAt` is set, the record disappears from lists and can be restored by an administrator in
 * the database. Documents (quotes, orders, invoices) cannot be deleted: their numbers are gap-free.
 */
import "server-only";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";

const DELETABLE = {
  leads: { delegate: "lead", entity: "Lead", branded: true },
  deals: { delegate: "deal", entity: "Deal", branded: true },
  cases: { delegate: "case", entity: "Case", branded: true },
  activities: { delegate: "activity", entity: "Activity", branded: true },
  accounts: { delegate: "account", entity: "Account", branded: false },
  contacts: { delegate: "contact", entity: "Contact", branded: false },
} as const satisfies Partial<Record<ModuleKey, { delegate: string; entity: string; branded: boolean }>>;
export type DeletableModule = keyof typeof DELETABLE;

export async function softDelete(ctx: AccessContext, module: DeletableModule, id: string): Promise<void> {
  const cfg = DELETABLE[module];
  assertCan(ctx, module, "delete");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over the deletable delegates
  const delegate = (scopedDb(ctx) as any)[cfg.delegate];
  const record = await delegate.findFirst({ where: { id, deletedAt: null } });
  if (!record) throw new NotFoundError(); // missing, already deleted or outside the caller's scope
  if (cfg.branded) assertCan(ctx, module, "delete", record);
  await delegate.update({ where: { id }, data: { deletedAt: new Date() }, select: { id: true } });
  // brand-owned writes are audited by scopedDb; the shared customer modules are audited here
  if (!cfg.branded) await audit({ ctx, action: "DELETE", entity: cfg.entity, entityId: id, before: { name: record.name ?? [record.firstName, record.lastName].filter(Boolean).join(" ") } });
}
