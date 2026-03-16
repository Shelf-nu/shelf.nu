-- Asset tables: Location, Category, Tag, Asset, Kit, and their dependents

-- ============================================================
-- Location
-- ============================================================

CREATE TABLE "Location" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"           text        NOT NULL,
  "description"    text,
  "address"        text,
  "latitude"       double precision,
  "longitude"      double precision,
  "imageUrl"       text,
  "thumbnailUrl"   text,
  "imageId"        text        UNIQUE,
  "userId"         text        NOT NULL,
  "organizationId" text        NOT NULL,
  "parentId"       text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "Location_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Location_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Location_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Location_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Location"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- Category
-- ============================================================

CREATE TABLE "Category" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"           text        NOT NULL,
  "description"    text,
  "color"          text        NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "userId"         text        NOT NULL,
  "organizationId" text        NOT NULL,

  CONSTRAINT "Category_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "Category_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Tag
-- ============================================================

CREATE TABLE "Tag" (
  "id"             text          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"           text          NOT NULL,
  "description"    text,
  "color"          text,
  "useFor"         "TagUseFor"[] NOT NULL DEFAULT '{ASSET}',
  "userId"         text          NOT NULL,
  "organizationId" text          NOT NULL,
  "createdAt"      timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT "Tag_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "Tag_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Asset
-- ============================================================

CREATE TABLE "Asset" (
  "id"              text          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "title"           text          NOT NULL,
  "description"     text,
  "mainImage"       text,
  "thumbnailImage"  text,
  "mainImageExpiration" timestamptz,
  "status"          "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
  "value"           double precision,  -- mapped from "valuation" in Prisma via @map("value")
  "availableToBook" boolean       NOT NULL DEFAULT true,
  "sequentialId"    text,
  "createdAt"       timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz   NOT NULL DEFAULT now(),
  "userId"          text          NOT NULL,
  "organizationId"  text          NOT NULL,
  "categoryId"      text,
  "locationId"      text,
  "kitId"           text,

  CONSTRAINT "Asset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Asset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Asset_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Asset_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  -- Kit FK added after Kit table is created

  CONSTRAINT "asset_org_sequential_unique"
    UNIQUE ("organizationId", "sequentialId")
);

-- ============================================================
-- Kit
-- ============================================================

CREATE TABLE "Kit" (
  "id"              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"            text        NOT NULL,
  "description"     text,
  "status"          "KitStatus" NOT NULL DEFAULT 'AVAILABLE',
  "image"           text,
  "imageExpiration" timestamptz,
  "organizationId"  text        NOT NULL,
  "createdById"     text        NOT NULL,
  "categoryId"      text,
  "locationId"      text,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "Kit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Kit_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "Kit_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Kit_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- Now add the deferred Kit FK on Asset
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ============================================================
-- TeamMember
-- ============================================================

CREATE TABLE "TeamMember" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"           text        NOT NULL,
  "organizationId" text        NOT NULL,
  "userId"         text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz,

  CONSTRAINT "TeamMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- Custody (Asset <-> TeamMember)
-- ============================================================

CREATE TABLE "Custody" (
  "id"           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamMemberId" text        NOT NULL,
  "assetId"      text        NOT NULL UNIQUE,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "Custody_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "Custody_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- KitCustody (Kit <-> TeamMember)
-- ============================================================

CREATE TABLE "KitCustody" (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "custodianId" text        NOT NULL,
  "kitId"       text        NOT NULL UNIQUE,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "KitCustody_custodianId_fkey"
    FOREIGN KEY ("custodianId") REFERENCES "TeamMember"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "KitCustody_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Asset-Tag junction (implicit many-to-many in Prisma)
-- ============================================================

CREATE TABLE "_AssetToTag" (
  "A" text NOT NULL REFERENCES "Asset"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "Tag"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_AssetToTag_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_AssetToTag_B_index" ON "_AssetToTag"("B");

-- ============================================================
-- Category-CustomField junction (added later in custom_fields migration)
-- ============================================================

-- ============================================================
-- AssetFilterPreset
-- ============================================================

CREATE TABLE "AssetFilterPreset" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text        NOT NULL,
  "ownerId"        text        NOT NULL,
  "name"           text        NOT NULL,
  "query"          text        NOT NULL,
  "starred"        boolean     NOT NULL DEFAULT false,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "AssetFilterPreset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AssetFilterPreset_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "asset_filter_presets_owner_name_unique"
    UNIQUE ("organizationId", "ownerId", "name")
);

-- ============================================================
-- AssetIndexSettings
-- ============================================================

CREATE TABLE "AssetIndexSettings" (
  "id"             text            PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"         text            NOT NULL,
  "organizationId" text            NOT NULL,
  "mode"           "AssetIndexMode" NOT NULL DEFAULT 'SIMPLE',
  "columns"        jsonb           NOT NULL DEFAULT '[{"name":"id","visible":true,"position":0},{"name":"status","visible":true,"position":1},{"name":"description","visible":true,"position":2},{"name":"valuation","visible":true,"position":3},{"name":"createdAt","visible":true,"position":4},{"name":"category","visible":true,"position":5},{"name":"tags","visible":true,"position":6},{"name":"location","visible":true,"position":7},{"name":"kit","visible":true,"position":8},{"name":"custody","visible":true,"position":9}]',
  "freezeColumn"   boolean         NOT NULL DEFAULT true,
  "showAssetImage" boolean         NOT NULL DEFAULT true,
  "createdAt"      timestamptz     NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT "AssetIndexSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AssetIndexSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AssetIndexSettings_userId_organizationId_key"
    UNIQUE ("userId", "organizationId")
);

-- ============================================================
-- AssetReminder
-- ============================================================

CREATE TABLE "AssetReminder" (
  "id"                       text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"                     text        NOT NULL,
  "message"                  text        NOT NULL,
  "alertDateTime"            timestamptz NOT NULL,
  "activeSchedulerReference" text,
  "organizationId"           text        NOT NULL,
  "assetId"                  text        NOT NULL,
  "createdById"              text        NOT NULL,
  "createdAt"                timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "AssetReminder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "AssetReminder_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AssetReminder_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- AssetReminder-TeamMember junction (implicit many-to-many)
CREATE TABLE "_AssetReminderToTeamMember" (
  "A" text NOT NULL REFERENCES "AssetReminder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "TeamMember"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_AssetReminderToTeamMember_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_AssetReminderToTeamMember_B_index" ON "_AssetReminderToTeamMember"("B");
