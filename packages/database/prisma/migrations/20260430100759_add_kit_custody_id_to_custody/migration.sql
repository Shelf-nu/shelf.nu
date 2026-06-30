-- Add a discriminator column to `Custody` so we can distinguish
-- "operator-assigned to this asset directly" (kitCustodyId IS NULL)
-- from "inherited because the asset's kit is in custody"
-- (kitCustodyId points at the parent KitCustody row).
--
-- ON DELETE CASCADE means releasing kit custody (deleting the parent
-- KitCustody row) automatically removes the inherited asset-side
-- Custody rows, while leaving operator-assigned rows untouched.

-- AlterTable
ALTER TABLE "Custody" ADD COLUMN "kitCustodyId" TEXT;

-- CreateIndex
CREATE INDEX "Custody_kitCustodyId_idx" ON "Custody"("kitCustodyId");

-- AddForeignKey
ALTER TABLE "Custody" ADD CONSTRAINT "Custody_kitCustodyId_fkey" FOREIGN KEY ("kitCustodyId") REFERENCES "KitCustody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: tag pre-existing kit-allocated Custody rows so the new
-- code can identify them. Without this, the cascade-delete and the
-- "filter by kitCustodyId" delete paths would orphan thousands of
-- legacy Custody rows in production (628+ KitCustody parents at
-- migration time, each with one Custody child per asset in its kit).
--
-- Logic: for each KitCustody, walk its kit's current assets; for each
-- asset, find the Custody row whose custodian matches the kit's
-- custodian and tag it. Pre-Phase-2 schema enforced one Custody per
-- (asset, teamMember) via @@unique, so at most one row matches per
-- pairing — no risk of mis-tagging unrelated operator-assigned rows.
UPDATE "Custody" c
SET "kitCustodyId" = kc.id
FROM "KitCustody" kc
JOIN "Asset" a ON a."kitId" = kc."kitId"
WHERE c."assetId" = a.id
  AND c."teamMemberId" = kc."custodianId"
  AND c."kitCustodyId" IS NULL;
