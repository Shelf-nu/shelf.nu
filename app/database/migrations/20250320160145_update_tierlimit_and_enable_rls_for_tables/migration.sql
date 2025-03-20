-- Custody Agreements limit is 0 for free and tier_1, we have to update that in DB

UPDATE "TierLimit"
SET "maxCustodyAgreements" = 0, "maxActiveCustodyAgreements" = 0
WHERE "id" IN ('free', 'tier_1');

-- Enable RLS
ALTER TABLE "Custody" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomTierLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Image" ENABLE ROW LEVEL SECURITY;