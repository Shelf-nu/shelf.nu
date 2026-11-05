-- PDF templates: saved layouts for the booking PDF, kept per team workspace.
-- Replaces "PdfDocument". This migration must be applied BEFORE the build that
-- reads "PdfTemplate" serves traffic.
--
-- "PdfDocument" and the columns "Organization"."paidPdfDocumentsSeededAt",
-- "TierLimit"."canCustomizePdfDocuments" and
-- "CustomTierLimit"."canCustomizePdfDocuments" are left untouched for the
-- cleanup PR. Only team workspaces get templates, so rows of personal
-- workspaces are not copied.

CREATE TYPE "PdfTemplateKind" AS ENUM ('BOOKING');

CREATE TABLE "PdfTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PdfTemplateKind" NOT NULL DEFAULT 'BOOKING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PdfTemplate_organizationId_kind_name_key" ON "PdfTemplate"("organizationId", "kind", "name");

ALTER TABLE "PdfTemplate" ADD CONSTRAINT "PdfTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default template per workspace and kind. Prisma cannot express
-- a partial unique index, so it lives only in this migration.
CREATE UNIQUE INDEX "PdfTemplate_one_default_per_organization_kind" ON "PdfTemplate"("organizationId", "kind") WHERE "isDefault";

-- Names are unique per workspace ignoring case, so the PDF dialog never lists
-- two templates that read the same. An expression index, so it lives only in
-- this migration; the case-sensitive unique above is what Prisma knows.
CREATE UNIQUE INDEX "PdfTemplate_organizationId_kind_lower_name_key" ON "PdfTemplate"("organizationId", "kind", lower("name"));

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "PdfTemplate" ENABLE ROW LEVEL SECURITY;

-- Copy the layouts of team workspaces, keeping ids so a remembered pick stays valid.
INSERT INTO "PdfTemplate" ("id", "name", "kind", "config", "isDefault", "organizationId", "createdAt", "updatedAt")
SELECT d."id", d."name", d."kind"::text::"PdfTemplateKind", d."config", d."isDefault", d."organizationId", d."createdAt", d."updatedAt"
FROM "PdfDocument" d
JOIN "Organization" o ON o."id" = d."organizationId"
WHERE o."type" = 'TEAM';

-- A team workspace left with no template gets the Checklist as its default.
-- The config matches BOOKING_CHECKLIST_CONFIG in the pdf-template module config.
INSERT INTO "PdfTemplate" ("id", "name", "kind", "config", "isDefault", "organizationId", "createdAt", "updatedAt")
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
WHERE o."type" = 'TEAM'
  AND NOT EXISTS (SELECT 1 FROM "PdfTemplate" t WHERE t."organizationId" = o."id")
ON CONFLICT DO NOTHING;

-- Team workspaces that were never offered the Check-out receipt get it. A
-- workspace with the seeded marker set was offered it already; if it is gone
-- there, an admin deleted it and it is not added back. A custom template
-- already named "Check-out receipt" wins. The config matches
-- CHECKOUT_RECEIPT_CONFIG in the pdf-template module config.
INSERT INTO "PdfTemplate" ("id", "name", "kind", "config", "isDefault", "organizationId", "createdAt", "updatedAt")
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
WHERE o."type" = 'TEAM'
  AND o."paidPdfDocumentsSeededAt" IS NULL
ON CONFLICT DO NOTHING;

-- A team workspace with templates but no default marks its oldest one default.
UPDATE "PdfTemplate" t
SET "isDefault" = true
FROM (
  SELECT DISTINCT ON ("organizationId") "id"
  FROM "PdfTemplate" p
  WHERE p."kind" = 'BOOKING'
    AND NOT EXISTS (
      SELECT 1 FROM "PdfTemplate" d
      WHERE d."organizationId" = p."organizationId" AND d."kind" = 'BOOKING' AND d."isDefault"
    )
  ORDER BY "organizationId", "createdAt", "name"
) oldest
WHERE t."id" = oldest."id";
