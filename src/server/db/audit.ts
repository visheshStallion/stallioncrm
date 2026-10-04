/**
 * audit() – append-only audit trail for create/update/delete/export/login.
 * Written with the system client (the RLS role has no access to AuditLog at all).
 * Failures are logged, never thrown: auditing must not break the user's action.
 */
import "server-only";
import type { AuditAction, Prisma } from "@prisma/client";
import type { AccessContext } from "@/server/access/types";
import { logger } from "@/server/log";
import { unsafeDb } from "./unsafe";

const REDACTED_KEYS = new Set(["passwordHash", "password", "token", "secret"]);

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  brandId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Acting user: from ctx, or explicit userId (login events). */
  ctx?: Pick<AccessContext, "userId" | "ip"> | null;
  userId?: string | null;
  ip?: string | null;
}

/** Plain-JSON copy with secrets redacted (Decimal → string, Date → ISO string). */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => (REDACTED_KEYS.has(key) ? "[redacted]" : v)),
  ) as Prisma.InputJsonValue;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await unsafeDb.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        brandId: entry.brandId ?? null,
        before: toAuditJson(entry.before),
        after: toAuditJson(entry.after),
        userId: entry.ctx?.userId ?? entry.userId ?? null,
        ip: entry.ctx?.ip ?? entry.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, entry: { ...entry, before: undefined, after: undefined } }, "audit write failed");
  }
}
