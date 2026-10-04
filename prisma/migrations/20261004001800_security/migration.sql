-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;


-- ---------------------------------------------------------------------------
-- Sign-in protection columns: readable in the user directory, except the TOTP secret
-- ---------------------------------------------------------------------------
GRANT SELECT ("failedLogins", "lockedUntil", "totpEnabledAt", "lastLoginAt") ON "User" TO stallion_rls;

-- ---------------------------------------------------------------------------
-- The audit log is append-only for EVERY role (user sessions had no access already).
-- The only change allowed is the reference to a removed user being set to NULL by the foreign key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = '23514';
  END IF;
  IF NEW."userId" IS NULL AND OLD."userId" IS NOT NULL
     AND NEW."at" = OLD."at" AND NEW."action" = OLD."action" AND NEW."entity" = OLD."entity"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId" AND NEW."brandId" IS NOT DISTINCT FROM OLD."brandId"
     AND NEW."before" IS NOT DISTINCT FROM OLD."before" AND NEW."after" IS NOT DISTINCT FROM OLD."after"
     AND NEW."ip" IS NOT DISTINCT FROM OLD."ip" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = '23514';
END
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app_audit_immutable();

-- ---------------------------------------------------------------------------
-- Restore hand-written objects that generated migration diffs dropped (they are unknown to the Prisma schema):
--   * 20261004001200 dropped the report indexes of 20261004001100,
--   * 20261004001700 dropped the brand foreign keys of the inventory tables.
-- From now on scripts/migrate-dev.ts keeps the objects listed in prisma/unmanaged.json, and
-- tests/integration/schema-guards.test.ts fails when one is missing.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Deal_closeDate_idx" ON "Deal" ("closeDate");
CREATE INDEX IF NOT EXISTS "Deal_stageEnteredAt_idx" ON "Deal" ("stageEnteredAt");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead" ("createdAt");

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('Warehouse', 'Warehouse_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('Vendor', 'Vendor_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('VehicleUnit', 'VehicleUnit_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('StockMovement', 'StockMovement_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('StockMovement', 'StockMovement_productId_fkey', 'productId', 'Product', 'RESTRICT'),
      ('StockMovement', 'StockMovement_warehouseId_fkey', 'warehouseId', 'Warehouse', 'RESTRICT'),
      ('InventoryDocument', 'InventoryDocument_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('JournalEntry', 'JournalEntry_brandId_fkey', 'brandId', 'Brand', 'RESTRICT'),
      ('InventorySettings', 'InventorySettings_brandId_fkey', 'brandId', 'Brand', 'CASCADE'),
      ('PushSubscription', 'PushSubscription_userId_fkey', 'userId', 'User', 'CASCADE')
    ) AS t(tbl, name, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I ("id") ON DELETE %s ON UPDATE CASCADE', fk.tbl, fk.name, fk.col, fk.ref, fk.on_delete);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Defence in depth: which brands a shared customer is linked to, and the per-brand marketing consent, are
-- brand information too. The application already limited them to the viewer's brands; now the database does.
-- (Writes to CustomerBrandLink stay with the SECURITY DEFINER trigger.)
-- ---------------------------------------------------------------------------
SELECT app_enable_brand_tag_rls('"CustomerBrandLink"');
SELECT app_enable_brand_tag_rls('"ContactBrandConsent"');
