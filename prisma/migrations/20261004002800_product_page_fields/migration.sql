-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "qtyInStock" DECIMAL(12,2),
ADD COLUMN     "qtyOrdered" DECIMAL(12,2),
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT true;


-- Hand-written: existing products – the manufacturer is their brand's name; a 0 % tax rate means not taxable
UPDATE "Product" p SET "manufacturer" = b."name" FROM "Brand" b WHERE b.id = p."brandId" AND p."manufacturer" IS NULL;
UPDATE "Product" SET "taxable" = false WHERE "taxRatePct" = 0;
