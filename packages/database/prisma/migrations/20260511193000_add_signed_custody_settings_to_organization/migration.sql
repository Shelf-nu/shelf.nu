-- Add signed custody workspace settings flags
ALTER TABLE "Organization"
ADD COLUMN "enableSignedCustodyOnAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireCustodySignatureOnAssignment" BOOLEAN NOT NULL DEFAULT false;
