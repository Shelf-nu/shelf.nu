-- PDF documents: saved layouts for the booking PDF, kept per workspace.

CREATE TYPE "PdfDocumentKind" AS ENUM ('BOOKING');

CREATE TABLE "PdfDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PdfDocumentKind" NOT NULL DEFAULT 'BOOKING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PdfDocument_organizationId_kind_name_key" ON "PdfDocument"("organizationId", "kind", "name");

ALTER TABLE "PdfDocument" ADD CONSTRAINT "PdfDocument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default document per workspace and kind. Prisma cannot express
-- a partial unique index, so it lives only in this migration.
CREATE UNIQUE INDEX "PdfDocument_one_default_per_organization_kind" ON "PdfDocument"("organizationId", "kind") WHERE "isDefault";

-- Names are unique per workspace ignoring case, so the PDF dialog never lists
-- two documents that read the same. An expression index, so it lives only in
-- this migration; the case-sensitive unique above is what Prisma knows.
CREATE UNIQUE INDEX "PdfDocument_organizationId_kind_lower_name_key" ON "PdfDocument"("organizationId", "kind", lower("name"));

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "PdfDocument" ENABLE ROW LEVEL SECURITY;

-- Choosing and editing PDF documents is a paid feature: Plus (tier_1), Team
-- (tier_2) and custom tiers. Free workspaces keep printing the Checklist.
ALTER TABLE "TierLimit" ADD COLUMN "canCustomizePdfDocuments" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomTierLimit" ADD COLUMN "canCustomizePdfDocuments" BOOLEAN NOT NULL DEFAULT true;
UPDATE "TierLimit" SET "canCustomizePdfDocuments" = true WHERE id IN ('tier_1', 'tier_2', 'custom');

-- Every existing workspace starts with "Checklist", which prints exactly the
-- booking PDF as it was. Workspaces whose owner is on a paid tier also get
-- "Check-out receipt". The config values match BOOKING_CHECKLIST_CONFIG and
-- CHECKOUT_RECEIPT_CONFIG in apps/webapp/app/modules/pdf-document/config.ts.
INSERT INTO "PdfDocument" ("id", "name", "kind", "config", "isDefault", "organizationId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Checklist',
  'BOOKING',
  '{"columns":{"image":true,"quantity":true,"kit":true,"category":true,"location":true},"customFieldIds":[],"assetDescription":true,"groupBy":"none","sortBy":"status","bookingDescription":true,"totalValue":true,"signatureLines":false}'::jsonb,
  true,
  o."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
ON CONFLICT DO NOTHING;

INSERT INTO "PdfDocument" ("id", "name", "kind", "config", "isDefault", "organizationId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Check-out receipt',
  'BOOKING',
  '{"columns":{"image":true,"quantity":true,"kit":true,"category":true,"location":true},"customFieldIds":[],"assetDescription":false,"groupBy":"none","sortBy":"name","bookingDescription":false,"totalValue":false,"signatureLines":true}'::jsonb,
  false,
  o."id",
  CURRENT_TIMESTAMP + interval '1 millisecond',
  CURRENT_TIMESTAMP + interval '1 millisecond'
FROM "Organization" o
JOIN "User" owner ON owner."id" = o."userId"
LEFT JOIN "CustomTierLimit" ctl ON ctl."userId" = owner."id"
WHERE owner."tierId" IN ('tier_1', 'tier_2')
   OR (owner."tierId" = 'custom' AND COALESCE(ctl."canCustomizePdfDocuments", true))
ON CONFLICT DO NOTHING;
