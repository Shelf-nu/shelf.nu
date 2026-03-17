-- Core tables: Tier, Role, User, Organization, and their direct dependents
-- These are the foundational tables that most other tables reference.

-- Required extension for trigram-based GIN indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Tier & TierLimit (Stripe product tiers)
-- ============================================================

CREATE TABLE "TierLimit" (
  "id"                   "TierId"    PRIMARY KEY,
  "canImportAssets"      boolean     NOT NULL DEFAULT false,
  "canExportAssets"      boolean     NOT NULL DEFAULT false,
  "canImportNRM"         boolean     NOT NULL DEFAULT false,
  "canHideShelfBranding" boolean     NOT NULL DEFAULT false,
  "maxCustomFields"      integer     NOT NULL DEFAULT 0,
  "maxOrganizations"     integer     NOT NULL DEFAULT 1,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Tier" (
  "id"          "TierId"    PRIMARY KEY,
  "name"        text        NOT NULL,
  "tierLimitId" "TierId"    UNIQUE,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "Tier_tierLimitId_fkey"
    FOREIGN KEY ("tierLimitId") REFERENCES "TierLimit"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- Role (master data)
-- ============================================================

CREATE TABLE "Role" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"      "Roles"     NOT NULL UNIQUE DEFAULT 'USER',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SsoDetails
-- ============================================================

CREATE TABLE "SsoDetails" (
  "id"                 text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "domain"             text        NOT NULL,
  "baseUserGroupId"    text,
  "selfServiceGroupId" text,
  "adminGroupId"       text,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- User
-- ============================================================

CREATE TABLE "User" (
  "id"                         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email"                      text        NOT NULL UNIQUE,
  "username"                   text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "firstName"                  text,
  "lastName"                   text,
  "profilePicture"             text,
  "usedFreeTrial"              boolean     NOT NULL DEFAULT false,
  "onboarded"                  boolean     NOT NULL DEFAULT false,
  "customerId"                 text        UNIQUE,
  "sso"                        boolean     NOT NULL DEFAULT false,
  "createdWithInvite"          boolean     NOT NULL DEFAULT false,
  "skipSubscriptionCheck"      boolean     NOT NULL DEFAULT false,
  "hasUnpaidInvoice"           boolean     NOT NULL DEFAULT false,
  "warnForNoPaymentMethod"     boolean     NOT NULL DEFAULT false,
  "lastSelectedOrganizationId" text,
  "createdAt"                  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                  timestamptz NOT NULL DEFAULT now(),
  "deletedAt"                  timestamptz,
  "tierId"                     "TierId"    NOT NULL DEFAULT 'free',
  "referralSource"             text,

  CONSTRAINT "User_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "Tier"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Unique composite constraint
ALTER TABLE "User" ADD CONSTRAINT "User_email_username_key" UNIQUE ("email", "username");

-- ============================================================
-- Image
-- ============================================================

CREATE TABLE "Image" (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contentType" text        NOT NULL,
  "altText"     text,
  "blob"        bytea       NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  "ownerOrgId"  text        NOT NULL,
  "userId"      text        NOT NULL,

  CONSTRAINT "Image_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);
-- Organization FK added after Organization table is created

-- ============================================================
-- Organization
-- ============================================================

CREATE TABLE "Organization" (
  "id"                            text                  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"                          text                  NOT NULL DEFAULT 'Personal',
  "type"                          "OrganizationType"    NOT NULL DEFAULT 'PERSONAL',
  "userId"                        text                  NOT NULL,
  "currency"                      "Currency"            NOT NULL DEFAULT 'USD',
  "imageId"                       text                  UNIQUE,
  "enabledSso"                    boolean               NOT NULL DEFAULT false,
  "ssoDetailsId"                  text,
  "selfServiceCanSeeCustody"      boolean               NOT NULL DEFAULT false,
  "selfServiceCanSeeBookings"     boolean               NOT NULL DEFAULT false,
  "baseUserCanSeeCustody"         boolean               NOT NULL DEFAULT false,
  "baseUserCanSeeBookings"        boolean               NOT NULL DEFAULT false,
  "barcodesEnabled"               boolean               NOT NULL DEFAULT false,
  "barcodesEnabledAt"             timestamptz,
  "auditsEnabled"                 boolean               NOT NULL DEFAULT false,
  "auditsEnabledAt"               timestamptz,
  "usedAuditTrial"                boolean               NOT NULL DEFAULT false,
  "workspaceDisabled"             boolean               NOT NULL DEFAULT false,
  "hasSequentialIdsMigrated"      boolean               NOT NULL DEFAULT false,
  "qrIdDisplayPreference"         "QrIdDisplayPreference" NOT NULL DEFAULT 'QR_ID',
  "showShelfBranding"             boolean               NOT NULL DEFAULT true,
  "customEmailFooter"             varchar(500),
  "createdAt"                     timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"                     timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT "Organization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Organization_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Organization_ssoDetailsId_fkey"
    FOREIGN KEY ("ssoDetailsId") REFERENCES "SsoDetails"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- Now add the deferred FKs that reference Organization
ALTER TABLE "Image"
  ADD CONSTRAINT "Image_ownerOrgId_fkey"
    FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_lastSelectedOrganizationId_fkey"
    FOREIGN KEY ("lastSelectedOrganizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ============================================================
-- UserContact
-- ============================================================

CREATE TABLE "UserContact" (
  "id"            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "phone"         text,
  "street"        text,
  "city"          text,
  "stateProvince" text,
  "zipPostalCode" text,
  "countryRegion" text,
  "userId"        text        NOT NULL UNIQUE,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "UserContact_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- UserBusinessIntel
-- ============================================================

CREATE TABLE "UserBusinessIntel" (
  "id"                   text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "howDidYouHearAboutUs" text,
  "jobTitle"             text,
  "teamSize"             text,
  "companyName"          text,
  "primaryUseCase"       text,
  "currentSolution"      text,
  "timeline"             text,
  "userId"               text        NOT NULL UNIQUE,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "UserBusinessIntel_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- CustomTierLimit (for users on the 'custom' tier)
-- ============================================================

CREATE TABLE "CustomTierLimit" (
  "id"                   text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"               text        UNIQUE,
  "canImportAssets"      boolean     NOT NULL DEFAULT true,
  "canExportAssets"      boolean     NOT NULL DEFAULT true,
  "canImportNRM"         boolean     NOT NULL DEFAULT true,
  "canHideShelfBranding" boolean     NOT NULL DEFAULT true,
  "maxCustomFields"      integer     NOT NULL DEFAULT 1000,
  "maxOrganizations"     integer     NOT NULL DEFAULT 1,
  "isEnterprise"         boolean     NOT NULL DEFAULT false,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "CustomTierLimit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- UserOrganization (many-to-many: User <-> Organization)
-- ============================================================

CREATE TABLE "UserOrganization" (
  "id"             text                  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"         text                  NOT NULL,
  "organizationId" text                  NOT NULL,
  "roles"          "OrganizationRoles"[] NOT NULL DEFAULT '{}',
  "createdAt"      timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT "UserOrganization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "UserOrganization_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "UserOrganization_userId_organizationId_key"
    UNIQUE ("userId", "organizationId")
);

-- ============================================================
-- User-Role many-to-many junction (implicit in Prisma)
-- ============================================================

CREATE TABLE "_RoleToUser" (
  "A" text NOT NULL REFERENCES "Role"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_RoleToUser_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");
