-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ON_ORDER', 'IN_TRANSIT', 'AT_PORT', 'IN_CLEARING', 'PDI_PENDING', 'AVAILABLE', 'RESERVED', 'ALLOCATED', 'INVOICED', 'DELIVERED', 'DEMO', 'ON_HOLD', 'TRANSFERRED', 'RETURNED', 'WRITTEN_OFF');

-- DropForeignKey
ALTER TABLE "VehicleStockRef" DROP CONSTRAINT "VehicleStockRef_brandId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleStockRef" DROP CONSTRAINT "VehicleStockRef_productId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costPrice" DECIMAL(14,2),
ADD COLUMN     "hsCode" TEXT,
ADD COLUMN     "preferredVendorId" TEXT,
ADD COLUMN     "reorderLevel" DECIMAL(12,2),
ADD COLUMN     "reorderQty" DECIMAL(12,2),
ADD COLUMN     "trackingType" TEXT NOT NULL DEFAULT 'SERIAL',
ADD COLUMN     "uom" TEXT NOT NULL DEFAULT 'unit',
ADD COLUMN     "valuationMethod" TEXT NOT NULL DEFAULT 'SPECIFIC';



-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MAIN_YARD',
    "regionId" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OEM',
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "paymentTerms" TEXT,
    "taxId" TEXT,
    "bankDetails" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleUnit" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "engineNo" TEXT,
    "colour" TEXT,
    "colourInterior" TEXT,
    "modelYear" INTEGER,
    "keyNo" TEXT,
    "plateNo" TEXT,
    "customsDocNo" TEXT,
    "importDutyPaid" BOOLEAN NOT NULL DEFAULT false,
    "warehouseId" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ON_ORDER',
    "purchaseCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "landedCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(14,2),
    "dealId" TEXT,
    "reservedById" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "salesOrderId" TEXT,
    "invoiceId" TEXT,
    "shipmentId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "pdiPassedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "mileage" INTEGER,
    "damageNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleStatusHistory" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "from" "VehicleStatus",
    "to" "VehicleStatus" NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vehicleUnitId" TEXT,
    "batchNo" TEXT NOT NULL DEFAULT '',
    "warehouseId" TEXT NOT NULL,
    "qtyIn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "movementType" TEXT NOT NULL,
    "sourceDocType" TEXT,
    "sourceDocId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "brandId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "value" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("brandId","productId","warehouseId","batchNo")
);

-- CreateTable
CREATE TABLE "InventoryDocument" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "vendorId" TEXT,
    "warehouseId" TEXT,
    "toWarehouseId" TEXT,
    "toBrandId" TEXT,
    "parentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "docDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" DATE,
    "reference" TEXT,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "updatedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryDocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "vehicleUnitId" TEXT,
    "vin" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "batchNo" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "InventoryDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "sourceDocType" TEXT,
    "sourceDocId" TEXT,
    "memo" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySettings" (
    "brandId" TEXT NOT NULL,
    "accounts" JSONB NOT NULL DEFAULT '{}',
    "reservationDays" INTEGER NOT NULL DEFAULT 7,
    "adjustmentApprovalLimit" DECIMAL(14,2) NOT NULL DEFAULT 500000,
    "poApprovalLimit" DECIMAL(16,2) NOT NULL DEFAULT 100000000,
    "lockDate" DATE,
    "partsValuation" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "pdiTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("brandId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_brandId_code_key" ON "Warehouse"("brandId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_brandId_name_key" ON "Vendor"("brandId", "name");

-- CreateIndex
CREATE INDEX "VehicleUnit_brandId_status_idx" ON "VehicleUnit"("brandId", "status");

-- CreateIndex
CREATE INDEX "VehicleUnit_productId_status_idx" ON "VehicleUnit"("productId", "status");

-- CreateIndex
CREATE INDEX "VehicleUnit_dealId_idx" ON "VehicleUnit"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleUnit_brandId_vin_key" ON "VehicleUnit"("brandId", "vin");

-- CreateIndex
CREATE INDEX "VehicleStatusHistory_unitId_at_idx" ON "VehicleStatusHistory"("unitId", "at");

-- CreateIndex
CREATE INDEX "StockMovement_brandId_productId_warehouseId_idx" ON "StockMovement"("brandId", "productId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_vehicleUnitId_idx" ON "StockMovement"("vehicleUnitId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceDocId_idx" ON "StockMovement"("sourceDocId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryDocument_number_key" ON "InventoryDocument"("number");

-- CreateIndex
CREATE INDEX "InventoryDocument_brandId_type_status_idx" ON "InventoryDocument"("brandId", "type", "status");

-- CreateIndex
CREATE INDEX "InventoryDocument_parentId_idx" ON "InventoryDocument"("parentId");

-- CreateIndex
CREATE INDEX "InventoryDocument_toBrandId_idx" ON "InventoryDocument"("toBrandId");

-- CreateIndex
CREATE INDEX "InventoryDocumentLine_documentId_idx" ON "InventoryDocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "InventoryDocumentLine_vehicleUnitId_idx" ON "InventoryDocumentLine"("vehicleUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_number_key" ON "JournalEntry"("number");

-- CreateIndex
CREATE INDEX "JournalEntry_brandId_date_idx" ON "JournalEntry"("brandId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceDocId_idx" ON "JournalEntry"("sourceDocId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- AddForeignKey
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleStatusHistory" ADD CONSTRAINT "VehicleStatusHistory_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "VehicleUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDocumentLine" ADD CONSTRAINT "InventoryDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "InventoryDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data: the stock references of prompt 05 become vehicle units
-- ---------------------------------------------------------------------------
INSERT INTO "VehicleUnit" ("id", "brandId", "productId", "vin", "colour", "status", "dealId", "receivedAt", "pdiPassedAt", "createdAt", "updatedAt")
SELECT s."id", s."brandId", s."productId", s."vin", s."colour",
       (CASE s."status"::text WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT' WHEN 'IN_STOCK' THEN 'AVAILABLE' WHEN 'RESERVED' THEN 'RESERVED' ELSE 'DELIVERED' END)::"VehicleStatus",
       s."dealId",
       CASE WHEN s."status"::text <> 'IN_TRANSIT' THEN s."createdAt" END,
       CASE WHEN s."status"::text <> 'IN_TRANSIT' THEN s."createdAt" END,
       s."createdAt", s."updatedAt"
FROM "VehicleStockRef" s;

DROP TABLE "VehicleStockRef";
DROP TYPE "StockStatus";

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryDocument" ADD CONSTRAINT "InventoryDocument_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventorySettings" ADD CONSTRAINT "InventorySettings_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A unit's product and warehouse, a movement's product and warehouse and a document's vendor and warehouses
-- must belong to the same brand: stock of two legal entities can never be mixed by a wrong reference.
CREATE OR REPLACE FUNCTION app_inventory_same_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_other text;
BEGIN
  IF TG_TABLE_NAME IN ('VehicleUnit', 'StockMovement') THEN
    SELECT "brandId" INTO v_other FROM "Product" WHERE id = NEW."productId";
    IF v_other IS DISTINCT FROM NEW."brandId" THEN
      RAISE EXCEPTION 'The product belongs to another brand' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'InventoryDocument' THEN
    IF NEW."vendorId" IS NOT NULL THEN
      SELECT "brandId" INTO v_other FROM "Vendor" WHERE id = NEW."vendorId";
      IF v_other IS DISTINCT FROM NEW."brandId" THEN
        RAISE EXCEPTION 'The vendor belongs to another brand' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."toWarehouseId" IS NOT NULL THEN
      SELECT "brandId" INTO v_other FROM "Warehouse" WHERE id = NEW."toWarehouseId";
      -- an inter-brand transfer is received into a warehouse of the receiving brand
      IF v_other IS DISTINCT FROM coalesce(NEW."toBrandId", NEW."brandId") THEN
        RAISE EXCEPTION 'The destination warehouse belongs to another brand' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF NEW."warehouseId" IS NOT NULL THEN
    SELECT "brandId" INTO v_other FROM "Warehouse" WHERE id = NEW."warehouseId";
    IF v_other IS DISTINCT FROM NEW."brandId" THEN
      RAISE EXCEPTION 'The warehouse belongs to another brand' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER unit_same_brand BEFORE INSERT OR UPDATE ON "VehicleUnit" FOR EACH ROW EXECUTE FUNCTION app_inventory_same_brand();
CREATE TRIGGER movement_same_brand BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION app_inventory_same_brand();
CREATE TRIGGER inventory_doc_same_brand BEFORE INSERT OR UPDATE ON "InventoryDocument" FOR EACH ROW EXECUTE FUNCTION app_inventory_same_brand();

-- A sold unit belongs to a deal / order / invoice of its own brand.
CREATE OR REPLACE FUNCTION app_unit_sale_same_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_other text;
BEGIN
  IF NEW."dealId" IS NOT NULL THEN
    SELECT "brandId" INTO v_other FROM "Deal" WHERE id = NEW."dealId";
    IF v_other IS DISTINCT FROM NEW."brandId" THEN RAISE EXCEPTION 'The deal belongs to another brand' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."salesOrderId" IS NOT NULL THEN
    SELECT "brandId" INTO v_other FROM "SalesOrder" WHERE id = NEW."salesOrderId";
    IF v_other IS DISTINCT FROM NEW."brandId" THEN RAISE EXCEPTION 'The sales order belongs to another brand' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."invoiceId" IS NOT NULL THEN
    SELECT "brandId" INTO v_other FROM "Invoice" WHERE id = NEW."invoiceId";
    IF v_other IS DISTINCT FROM NEW."brandId" THEN RAISE EXCEPTION 'The invoice belongs to another brand' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER unit_sale_same_brand BEFORE INSERT OR UPDATE ON "VehicleUnit" FOR EACH ROW EXECUTE FUNCTION app_unit_sale_same_brand();

-- The stock ledger, status history and posted journals are append-only for EVERY role.
CREATE OR REPLACE FUNCTION app_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: post a correcting entry instead', TG_TABLE_NAME USING ERRCODE = '23514';
END
$$;
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION app_append_only();
CREATE TRIGGER journal_line_append_only BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION app_append_only();

-- A posted journal only ever changes its export marker.
CREATE OR REPLACE FUNCTION app_journal_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journals cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."brandId" IS DISTINCT FROM OLD."brandId" OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."memo" IS DISTINCT FROM OLD."memo" OR NEW."sourceDocId" IS DISTINCT FROM OLD."sourceDocId" OR NEW."sourceDocType" IS DISTINCT FROM OLD."sourceDocType" THEN
    RAISE EXCEPTION 'Posted journals cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION app_journal_immutable();

-- Journals must balance (checked when the transaction commits).
CREATE OR REPLACE FUNCTION app_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_diff numeric;
BEGIN
  SELECT coalesce(sum("debit"), 0) - coalesce(sum("credit"), 0) INTO v_diff FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'Journal % does not balance (difference %)', NEW."entryId", v_diff USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_journal_balanced();

-- Gap-free numbers per brand, type and year (same counter as quotes, orders and invoices).
CREATE OR REPLACE FUNCTION app_inventory_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_year int;
  v_seq int;
  v_code text;
BEGIN
  IF TG_OP = 'INSERT' AND coalesce(NEW."number", '') = '' THEN
    IF TG_TABLE_NAME = 'JournalEntry' THEN
      v_code := 'JV';
      v_year := extract(year FROM NEW."date")::int;
    ELSE
      v_code := CASE NEW."type"
        WHEN 'PO' THEN 'PO' WHEN 'SHIPMENT' THEN 'SHP' WHEN 'GRN' THEN 'GRN' WHEN 'BILL' THEN 'BILL' WHEN 'LANDED_COST' THEN 'LC'
        WHEN 'TRANSFER' THEN 'TO' WHEN 'INTER_BRAND' THEN 'IBT' WHEN 'ADJUSTMENT' THEN 'ADJ' WHEN 'PDI' THEN 'PDI'
        WHEN 'DELIVERY_NOTE' THEN 'DN' WHEN 'STOCK_COUNT' THEN 'SC' WHEN 'VENDOR_CREDIT' THEN 'VC' END;
      IF v_code IS NULL THEN
        RAISE EXCEPTION 'Unknown inventory document type %', NEW."type" USING ERRCODE = '23514';
      END IF;
      v_year := extract(year FROM NEW."createdAt")::int;
    END IF;
    INSERT INTO "DocumentCounter" ("brandId", "type", "year", "last") VALUES (NEW."brandId", v_code, v_year, 1)
    ON CONFLICT ("brandId", "type", "year") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
    RETURNING "last" INTO v_seq;
    SELECT coalesce(nullif("docPrefix", ''), code) INTO v_prefix FROM "Brand" WHERE id = NEW."brandId";
    NEW."number" := v_prefix || '-' || v_code || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  ELSIF TG_OP = 'UPDATE' AND (NEW."number" IS DISTINCT FROM OLD."number" OR NEW."brandId" IS DISTINCT FROM OLD."brandId") THEN
    RAISE EXCEPTION 'Document numbers and brands cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inventory_doc_number BEFORE INSERT OR UPDATE ON "InventoryDocument" FOR EACH ROW EXECUTE FUNCTION app_inventory_number();
CREATE TRIGGER journal_number BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION app_inventory_number();

-- ---------------------------------------------------------------------------
-- Row level security: every inventory table is visible to users of its brand only
-- ---------------------------------------------------------------------------
SELECT app_enable_brand_tag_rls('"Warehouse"');
SELECT app_enable_brand_tag_rls('"Vendor"');
SELECT app_enable_brand_tag_rls('"VehicleUnit"');
SELECT app_enable_brand_tag_rls('"VehicleStatusHistory"');
SELECT app_enable_brand_tag_rls('"StockMovement"');
SELECT app_enable_brand_tag_rls('"StockBalance"');
SELECT app_enable_brand_tag_rls('"InventoryDocument"');
SELECT app_enable_brand_tag_rls('"JournalEntry"');
SELECT app_enable_brand_tag_rls('"InventorySettings"');

-- Lines follow their header (the header's policy applies inside the subquery).
ALTER TABLE "InventoryDocumentLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_line ON "InventoryDocumentLine" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "InventoryDocument" d WHERE d.id = "documentId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "InventoryDocument" d WHERE d.id = "documentId"));
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_line ON "JournalLine" FOR SELECT TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e.id = "entryId"));

-- Postings (ledger, balances, journals, status history) are written by the posting engine (system client)
-- inside one transaction; user sessions can read them but never write them.
REVOKE INSERT, UPDATE, DELETE ON "StockMovement", "StockBalance", "JournalEntry", "JournalLine", "VehicleStatusHistory" FROM stallion_rls;

-- ---------------------------------------------------------------------------
-- Permissions: capability modules "inventory" (stock and documents) and "inventoryFinance" (cost, bills,
-- landed cost, valuation, journals) – BUSINESS_CONTEXT, section Inventory
-- ---------------------------------------------------------------------------
UPDATE "Profile" SET permissions = permissions || '{"inventory": {"read": true}}'::jsonb WHERE name IN ('Sales Exec', 'RSM');
UPDATE "Profile" SET permissions = permissions
  || '{"inventory": {"read": true, "create": true, "edit": true, "approve": true, "export": true}, "inventoryFinance": {"read": true, "approve": true, "export": true}}'::jsonb
WHERE name = 'Brand Manager';
UPDATE "Profile" SET permissions = permissions
  || '{"inventory": {"read": true, "approve": true, "export": true}, "inventoryFinance": {"read": true, "export": true}}'::jsonb
WHERE name = 'Management';
UPDATE "Profile" SET permissions = permissions
  || '{"inventory": {"read": true, "create": true, "edit": true, "delete": true, "approve": true, "export": true}, "inventoryFinance": {"read": true, "create": true, "edit": true, "approve": true, "export": true}}'::jsonb
WHERE name = 'Administrator';

INSERT INTO "Profile" ("id", "name", "scope", "permissions", "fieldPermissions")
SELECT 'prof_' || md5(v.name), v.name, 'TERRITORY'::"ProfileScope", v.permissions::jsonb, '{}'::jsonb
FROM (VALUES
  ('Inventory Officer', '{"inventory": {"read": true, "create": true, "edit": true}, "products": {"read": true}, "deals": {"read": true}, "salesOrders": {"read": true}}'),
  ('Logistics', '{"inventory": {"read": true, "create": true, "edit": true}, "inventoryFinance": {"read": true, "create": true}, "products": {"read": true}}'),
  ('Inventory Finance', '{"inventory": {"read": true, "export": true}, "inventoryFinance": {"read": true, "create": true, "edit": true, "approve": true, "export": true}, "products": {"read": true}, "invoices": {"read": true}, "salesOrders": {"read": true}}')
) AS v(name, permissions)
WHERE NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p.name = v.name);

-- Parts and accessories are quantity-tracked.
UPDATE "Product" SET "trackingType" = 'NONE', "valuationMethod" = 'WEIGHTED_AVERAGE' WHERE "category"::text <> 'VEHICLE';

-- Spare parts.
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'PART';
