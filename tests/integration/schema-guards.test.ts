import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unsafeDb } from "./helpers";

/**
 * Hand-written database objects (prisma/unmanaged.json) must survive every migration. `prisma migrate diff`
 * proposes to drop anything the Prisma schema does not know – this happened twice before the guard existed.
 */
const unmanaged = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../prisma/unmanaged.json"), "utf8")) as { indexes: string[]; foreignKeys: string[] };

describe("hand-written database objects", () => {
  it("every index of prisma/unmanaged.json exists", async () => {
    const rows = await unsafeDb.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const present = new Set(rows.map((r) => r.indexname));
    expect(unmanaged.indexes.filter((i) => !present.has(i)), "missing indexes").toEqual([]);
  });

  it("every foreign key of prisma/unmanaged.json exists", async () => {
    const rows = await unsafeDb.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint WHERE contype = 'f'`;
    const present = new Set(rows.map((r) => r.conname));
    expect(unmanaged.foreignKeys.filter((f) => !present.has(f)), "missing foreign keys").toEqual([]);
  });

  it("the triggers that protect the ledger, journals, audit log and brand consistency exist", async () => {
    const rows = await unsafeDb.$queryRaw<Array<{ tgname: string }>>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    const present = new Set(rows.map((r) => r.tgname));
    for (const t of ["audit_immutable", "stock_movement_append_only", "journal_immutable", "journal_balanced", "journal_line_append_only", "unit_same_brand", "unit_sale_same_brand", "inventory_doc_same_brand", "inventory_doc_number"]) expect(present.has(t), `trigger ${t}`).toBe(true);
  });

  it("row-level security is enabled on every table that carries a brand", async () => {
    const rows = await unsafeDb.$queryRaw<Array<{ table_name: string; relrowsecurity: boolean }>>`
      SELECT c.table_name, k.relrowsecurity
      FROM information_schema.columns c JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
      WHERE c.table_schema = 'public' AND c.column_name = 'brandId'`;
    // tables with a brandId that are NOT isolated by RLS, each for a stated reason
    const exempt: Record<string, string> = {
      Territory: "organisation structure: readable by everyone, written by administrators",
      Pipeline: "configuration (stages of a brand): readable, written by administrators – no customer or sales data",
      AssignmentRule: "configuration: readable, written by administrators",
      ApprovalProcess: "configuration: readable, written by the system client",
      WorkflowRule: "configuration: readable, written by the system client",
      BrandCodeAlias: "shared directory",
      AuditLog: "no access at all for user sessions",
      Job: "system table: no access for user sessions",
      DomainEvent: "system table: no access for user sessions",
      DocumentCounter: "system table: no access for user sessions",
      ExternalRef: "system table: no access for user sessions",
      PaymentLink: "system table: no access for user sessions",
      WebhookDelivery: "system table: no access for user sessions",
    };
    const unprotected = rows.filter((r) => !r.relrowsecurity && !exempt[r.table_name]).map((r) => r.table_name);
    expect(unprotected, "tables with a brandId but without row-level security – enable RLS or add an exemption with its reason").toEqual([]);
  });
});
