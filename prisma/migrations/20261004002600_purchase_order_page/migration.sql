-- AlterTable
ALTER TABLE "InventoryDocument" ADD COLUMN     "adjustment" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billTo" JSONB,
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "documentTaxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "exciseDuty" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "formViewId" TEXT,
ADD COLUMN     "headerDiscountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "headerDiscountValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "requisitionNumber" TEXT,
ADD COLUMN     "salesCommission" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shipTo" JSONB,
ADD COLUMN     "subTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "taxTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "vendorContactId" TEXT;

-- AlterTable
ALTER TABLE "InventoryDocumentLine" ADD COLUMN     "amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "details" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "discountValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expectedVins" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "isStockItem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itemCode" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "uom" TEXT;

-- AlterTable
ALTER TABLE "InventorySettings" ADD COLUMN     "addExciseToTotal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowManualPoNumber" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "carriers" TEXT[] DEFAULT ARRAY['FedEx', 'DHL', 'UPS', 'GIG Logistics', 'Red Star Express', 'Shipping line', 'Own transport', 'Other']::TEXT[],
ADD COLUMN     "poFormViews" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "poTerms" TEXT,
ADD COLUMN     "receivingWarehouseId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "VendorContact" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorContact_vendorId_idx" ON "VendorContact"("vendorId");


-- ---------------------------------------------------------------------------
-- Hand-written (prompt 25): vendor contacts belong to their vendor's brand; a PO's contact belongs to its vendor
-- ---------------------------------------------------------------------------
ALTER TABLE "VendorContact" ADD CONSTRAINT "VendorContact_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorContact" ADD CONSTRAINT "VendorContact_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
SELECT app_enable_brand_tag_rls('"VendorContact"');

CREATE OR REPLACE FUNCTION app_vendor_contact_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_vendor text;
BEGIN
  IF TG_TABLE_NAME = 'VendorContact' THEN
    SELECT "brandId" INTO v_brand FROM "Vendor" WHERE id = NEW."vendorId";
    IF v_brand IS DISTINCT FROM NEW."brandId" THEN
      RAISE EXCEPTION 'The contact must belong to the vendor''s brand' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."vendorContactId" IS NOT NULL THEN
    SELECT "brandId", "vendorId" INTO v_brand, v_vendor FROM "VendorContact" WHERE id = NEW."vendorContactId";
    IF v_brand IS DISTINCT FROM NEW."brandId" OR v_vendor IS DISTINCT FROM NEW."vendorId" THEN
      RAISE EXCEPTION 'The contact belongs to another vendor' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER vendor_contact_same_brand BEFORE INSERT OR UPDATE ON "VendorContact" FOR EACH ROW EXECUTE FUNCTION app_vendor_contact_check();
CREATE TRIGGER inventory_doc_contact BEFORE INSERT OR UPDATE OF "vendorContactId", "vendorId" ON "InventoryDocument" FOR EACH ROW EXECUTE FUNCTION app_vendor_contact_check();

-- the vendors' contact person becomes their first vendor contact
INSERT INTO "VendorContact" ("id", "brandId", "vendorId", "name", "email", "phone")
SELECT 'vc' || substr(md5(v.id), 1, 23), v."brandId", v.id, v."contactName", v.email, v.phone
FROM "Vendor" v WHERE coalesce(v."contactName", '') <> '';

-- existing lines: the grid figures from the old ones (no discount, no tax)
UPDATE "InventoryDocumentLine" SET "amount" = round(abs("qty") * "unitCost", 2), "total" = "lineTotal";
UPDATE "InventoryDocument" SET "subTotal" = "total" WHERE "type" = 'PO';
-- existing purchase orders: the vendor reference is their subject until someone gives them one
UPDATE "InventoryDocument" SET "subject" = coalesce(nullif("reference", ''), "number") WHERE "type" = 'PO' AND "subject" IS NULL;
