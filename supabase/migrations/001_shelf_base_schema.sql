-- =============================================================================
-- 001_shelf_base_schema.sql
-- Clean current-state DDL converted from Prisma schema (48 models, 20 enums)
-- Generated from: packages/database/prisma/schema.prisma (1,666 lines)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------

CREATE TYPE asset_status AS ENUM ('AVAILABLE', 'IN_CUSTODY', 'CHECKED_OUT');

CREATE TYPE asset_index_mode AS ENUM ('SIMPLE', 'ADVANCED');

CREATE TYPE tag_use_for AS ENUM ('ASSET', 'BOOKING');

CREATE TYPE note_type AS ENUM ('COMMENT', 'UPDATE');

CREATE TYPE error_correction AS ENUM ('L', 'M', 'Q', 'H');

CREATE TYPE barcode_type AS ENUM ('Code128', 'Code39', 'DataMatrix', 'ExternalQR', 'EAN13');

CREATE TYPE roles AS ENUM ('USER', 'ADMIN');

CREATE TYPE organization_type AS ENUM ('PERSONAL', 'TEAM');

CREATE TYPE qr_id_display_preference AS ENUM ('QR_ID', 'SAM_ID');

CREATE TYPE organization_roles AS ENUM ('ADMIN', 'BASE', 'OWNER', 'SELF_SERVICE');

CREATE TYPE tier_id AS ENUM ('free', 'tier_1', 'tier_2', 'custom');

CREATE TYPE custom_field_type AS ENUM ('TEXT', 'OPTION', 'BOOLEAN', 'DATE', 'MULTILINE_TEXT', 'AMOUNT', 'NUMBER');

CREATE TYPE currency AS ENUM (
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
  'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
  'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY',
  'COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP',
  'ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD',
  'GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR',
  'IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF',
  'KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL',
  'LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR',
  'MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR',
  'NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR',
  'RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD',
  'SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB',
  'TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX',
  'USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XOF',
  'XPF','YER','ZAR','ZMW','ZWL'
);

CREATE TYPE invite_statuses AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'INVALIDATED');

CREATE TYPE booking_status AS ENUM ('DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE', 'COMPLETE', 'ARCHIVED', 'CANCELLED');

CREATE TYPE kit_status AS ENUM ('AVAILABLE', 'IN_CUSTODY', 'CHECKED_OUT');

CREATE TYPE update_status AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TYPE audit_status AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TYPE audit_asset_status AS ENUM ('PENDING', 'FOUND', 'MISSING', 'UNEXPECTED');

CREATE TYPE audit_assignment_role AS ENUM ('LEAD', 'PARTICIPANT');

-- ---------------------------------------------------------------------------
-- 2. Tables (columns, PKs, inline UNIQUE, defaults, NOT NULL)
--    No FK constraints here — added in Section 3 to avoid circular deps.
-- ---------------------------------------------------------------------------

-- 2.01 Tier (referenced by User.tierId)
CREATE TABLE "Tier" (
  id           tier_id      PRIMARY KEY,
  name         text         NOT NULL,
  "tierLimitId" tier_id    UNIQUE,
  "createdAt"  timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz  NOT NULL DEFAULT now()
);

-- 2.02 TierLimit
CREATE TABLE "TierLimit" (
  id                     tier_id      PRIMARY KEY,
  "canImportAssets"      boolean      NOT NULL DEFAULT false,
  "canExportAssets"      boolean      NOT NULL DEFAULT false,
  "canImportNRM"         boolean      NOT NULL DEFAULT false,
  "canHideShelfBranding" boolean      NOT NULL DEFAULT false,
  "maxCustomFields"      integer      NOT NULL DEFAULT 0,
  "maxOrganizations"     integer      NOT NULL DEFAULT 1,
  "createdAt"            timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz  NOT NULL DEFAULT now()
);

-- 2.03 SsoDetails
CREATE TABLE "SsoDetails" (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  domain               text         NOT NULL,
  "baseUserGroupId"    text,
  "selfServiceGroupId" text,
  "adminGroupId"       text,
  "createdAt"          timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz  NOT NULL DEFAULT now()
);

-- 2.04 User
CREATE TABLE "User" (
  id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  email                        text         NOT NULL UNIQUE,
  username                     text         NOT NULL UNIQUE,
  "firstName"                  text,
  "lastName"                   text,
  "profilePicture"             text,
  "usedFreeTrial"              boolean      NOT NULL DEFAULT false,
  onboarded                    boolean      NOT NULL DEFAULT false,
  "customerId"                 text         UNIQUE,
  sso                          boolean      NOT NULL DEFAULT false,
  "createdWithInvite"          boolean      NOT NULL DEFAULT false,
  "skipSubscriptionCheck"      boolean      NOT NULL DEFAULT false,
  "hasUnpaidInvoice"           boolean      NOT NULL DEFAULT false,
  "warnForNoPaymentMethod"     boolean      NOT NULL DEFAULT false,
  "lastSelectedOrganizationId" uuid,
  "createdAt"                  timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"                  timestamptz  NOT NULL DEFAULT now(),
  "deletedAt"                  timestamptz,
  "tierId"                     tier_id      NOT NULL DEFAULT 'free',
  "referralSource"             text,

  UNIQUE (email, username)
);

-- 2.05 UserContact
CREATE TABLE "UserContact" (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text,
  street          text,
  city            text,
  "stateProvince" text,
  "zipPostalCode" text,
  "countryRegion" text,
  "userId"        uuid         NOT NULL UNIQUE,
  "createdAt"     timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz  NOT NULL DEFAULT now()
);

-- 2.06 UserBusinessIntel
CREATE TABLE "UserBusinessIntel" (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "howDidYouHearAboutUs" text,
  "jobTitle"             text,
  "teamSize"             text,
  "companyName"          text,
  "primaryUseCase"       text,
  "currentSolution"      text,
  timeline               text,
  "userId"               uuid         NOT NULL UNIQUE,
  "createdAt"            timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz  NOT NULL DEFAULT now()
);

-- 2.07 Organization
CREATE TABLE "Organization" (
  id                            uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  name                          text                    NOT NULL DEFAULT 'Personal',
  type                          organization_type       NOT NULL DEFAULT 'PERSONAL',
  "userId"                      uuid                    NOT NULL,
  currency                      currency                NOT NULL DEFAULT 'USD',
  "imageId"                     uuid                    UNIQUE,
  "enabledSso"                  boolean                 NOT NULL DEFAULT false,
  "ssoDetailsId"                uuid,
  "selfServiceCanSeeCustody"    boolean                 NOT NULL DEFAULT false,
  "selfServiceCanSeeBookings"   boolean                 NOT NULL DEFAULT false,
  "baseUserCanSeeCustody"       boolean                 NOT NULL DEFAULT false,
  "baseUserCanSeeBookings"      boolean                 NOT NULL DEFAULT false,
  "barcodesEnabled"             boolean                 NOT NULL DEFAULT false,
  "barcodesEnabledAt"           timestamptz,
  "auditsEnabled"               boolean                 NOT NULL DEFAULT false,
  "auditsEnabledAt"             timestamptz,
  "usedAuditTrial"              boolean                 NOT NULL DEFAULT false,
  "workspaceDisabled"           boolean                 NOT NULL DEFAULT false,
  "createdAt"                   timestamptz             NOT NULL DEFAULT now(),
  "updatedAt"                   timestamptz             NOT NULL DEFAULT now(),
  "hasSequentialIdsMigrated"    boolean                 NOT NULL DEFAULT false,
  "qrIdDisplayPreference"       qr_id_display_preference NOT NULL DEFAULT 'QR_ID',
  "showShelfBranding"           boolean                 NOT NULL DEFAULT true,
  "customEmailFooter"           varchar(500)
);

-- 2.08 Image
CREATE TABLE "Image" (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "contentType" text         NOT NULL,
  "altText"     text,
  blob          bytea        NOT NULL,
  "createdAt"   timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz  NOT NULL DEFAULT now(),
  "ownerOrgId"  uuid         NOT NULL,
  "userId"      uuid         NOT NULL
);

-- 2.09 Location
CREATE TABLE "Location" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text         NOT NULL,
  description      text,
  address          text,
  latitude         double precision,
  longitude        double precision,
  "imageUrl"       text,
  "thumbnailUrl"   text,
  "imageId"        uuid         UNIQUE,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
  "userId"         uuid         NOT NULL,
  "organizationId" uuid         NOT NULL,
  "parentId"       uuid
);

-- 2.10 Category
CREATE TABLE "Category" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text         NOT NULL,
  description      text,
  color            text         NOT NULL,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
  "userId"         uuid         NOT NULL,
  "organizationId" uuid         NOT NULL
);

-- 2.11 Kit
CREATE TABLE "Kit" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text         NOT NULL,
  description      text,
  status           kit_status   NOT NULL DEFAULT 'AVAILABLE',
  image            text,
  "imageExpiration" timestamptz,
  "organizationId" uuid         NOT NULL,
  "createdById"    uuid         NOT NULL,
  "categoryId"     uuid,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
  "locationId"     uuid
);

-- 2.12 Asset
CREATE TABLE "Asset" (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text         NOT NULL,
  description          text,
  "mainImage"          text,
  "thumbnailImage"     text,
  "mainImageExpiration" timestamptz,
  status               asset_status NOT NULL DEFAULT 'AVAILABLE',
  value                double precision,  -- mapped from "valuation" via @map("value")
  "availableToBook"    boolean      NOT NULL DEFAULT true,
  "sequentialId"       text,
  "createdAt"          timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz  NOT NULL DEFAULT now(),
  "userId"             uuid         NOT NULL,
  "organizationId"     uuid         NOT NULL,
  "categoryId"         uuid,
  "locationId"         uuid,
  "kitId"              uuid
);

-- 2.13 AssetFilterPreset
CREATE TABLE "AssetFilterPreset" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid         NOT NULL,
  "ownerId"        uuid         NOT NULL,
  name             text         NOT NULL,
  query            text         NOT NULL,
  starred          boolean      NOT NULL DEFAULT false,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now()
);

-- 2.14 AssetIndexSettings
CREATE TABLE "AssetIndexSettings" (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         uuid             NOT NULL,
  "organizationId" uuid             NOT NULL,
  mode             asset_index_mode NOT NULL DEFAULT 'SIMPLE',
  columns          jsonb            NOT NULL DEFAULT '[{"name":"id","visible":true,"position":0},{"name":"status","visible":true,"position":1},{"name":"description","visible":true,"position":2},{"name":"valuation","visible":true,"position":3},{"name":"createdAt","visible":true,"position":4},{"name":"category","visible":true,"position":5},{"name":"tags","visible":true,"position":6},{"name":"location","visible":true,"position":7},{"name":"kit","visible":true,"position":8},{"name":"custody","visible":true,"position":9}]',
  "freezeColumn"   boolean          NOT NULL DEFAULT true,
  "showAssetImage" boolean          NOT NULL DEFAULT true,
  "createdAt"      timestamptz      NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz      NOT NULL DEFAULT now(),

  UNIQUE ("userId", "organizationId")
);

-- 2.15 Tag
CREATE TABLE "Tag" (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text          NOT NULL,
  description      text,
  color            text,
  "useFor"         tag_use_for[] NOT NULL DEFAULT '{ASSET}',
  "userId"         uuid          NOT NULL,
  "organizationId" uuid          NOT NULL,
  "createdAt"      timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz   NOT NULL DEFAULT now()
);

-- 2.16 Note
CREATE TABLE "Note" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content     text        NOT NULL,
  type        note_type   NOT NULL DEFAULT 'COMMENT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "userId"    uuid,
  "assetId"   uuid        NOT NULL
);

-- 2.17 BookingNote
CREATE TABLE "BookingNote" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content     text        NOT NULL,
  type        note_type   NOT NULL DEFAULT 'COMMENT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "userId"    uuid,
  "bookingId" uuid        NOT NULL
);

-- 2.18 LocationNote
CREATE TABLE "LocationNote" (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content      text        NOT NULL,
  type         note_type   NOT NULL DEFAULT 'COMMENT',
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  "userId"     uuid,
  "locationId" uuid        NOT NULL
);

-- 2.19 Qr
CREATE TABLE "Qr" (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  version          integer          NOT NULL DEFAULT 0,
  "errorCorrection" error_correction NOT NULL DEFAULT 'L',
  "assetId"        uuid,
  "kitId"          uuid,
  "userId"         uuid,
  "organizationId" uuid,
  "batchId"        uuid,
  "createdAt"      timestamptz      NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz      NOT NULL DEFAULT now()
);

-- 2.20 Barcode
CREATE TABLE "Barcode" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  value            text         NOT NULL,
  type             barcode_type NOT NULL DEFAULT 'Code128',
  "assetId"        uuid,
  "kitId"          uuid,
  "organizationId" uuid         NOT NULL,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),

  UNIQUE ("organizationId", value)
);

-- 2.21 PrintBatch
CREATE TABLE "PrintBatch" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  printed     boolean     NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 2.22 ReportFound
CREATE TABLE "ReportFound" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  content     text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "assetId"   uuid,
  "kitId"     uuid
);

-- 2.23 Scan
CREATE TABLE "Scan" (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude            text,
  longitude           text,
  "userAgent"         text,
  "userId"            uuid,
  "qrId"              uuid,
  "rawQrId"           text        NOT NULL,
  "manuallyGenerated" boolean     NOT NULL DEFAULT false,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

-- 2.24 Role
CREATE TABLE "Role" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        roles       NOT NULL UNIQUE DEFAULT 'USER',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 2.25 TeamMember
CREATE TABLE "TeamMember" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  "organizationId" uuid        NOT NULL,
  "userId"         uuid,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz
);

-- 2.26 Custody
CREATE TABLE "Custody" (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamMemberId" uuid        NOT NULL,
  "assetId"      uuid        NOT NULL UNIQUE,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- 2.27 UserOrganization
CREATE TABLE "UserOrganization" (
  id               uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         uuid                NOT NULL,
  "organizationId" uuid                NOT NULL,
  roles            organization_roles[] NOT NULL DEFAULT '{}',
  "createdAt"      timestamptz         NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz         NOT NULL DEFAULT now(),

  UNIQUE ("userId", "organizationId")
);

-- 2.28 CustomField
CREATE TABLE "CustomField" (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text              NOT NULL,
  "helpText"       text,
  required         boolean           NOT NULL DEFAULT false,
  active           boolean           NOT NULL DEFAULT true,
  type             custom_field_type NOT NULL DEFAULT 'TEXT',
  options          text[]            NOT NULL DEFAULT '{}',
  "organizationId" uuid              NOT NULL,
  "userId"         uuid              NOT NULL,
  "createdAt"      timestamptz       NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz       NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz
);

-- 2.29 AssetCustomFieldValue
CREATE TABLE "AssetCustomFieldValue" (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  value           jsonb       NOT NULL,
  "assetId"       uuid        NOT NULL,
  "customFieldId" uuid        NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

-- 2.30 CustomTierLimit
CREATE TABLE "CustomTierLimit" (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"               uuid        UNIQUE,
  "canImportAssets"      boolean     NOT NULL DEFAULT true,
  "canExportAssets"      boolean     NOT NULL DEFAULT true,
  "canImportNRM"         boolean     NOT NULL DEFAULT true,
  "canHideShelfBranding" boolean     NOT NULL DEFAULT true,
  "maxCustomFields"      integer     NOT NULL DEFAULT 1000,
  "maxOrganizations"     integer     NOT NULL DEFAULT 1,
  "isEnterprise"         boolean     NOT NULL DEFAULT false,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

-- 2.31 Invite
CREATE TABLE "Invite" (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  "inviterId"     uuid                NOT NULL,
  "organizationId" uuid               NOT NULL,
  "inviteeUserId" uuid,
  "teamMemberId"  uuid                NOT NULL,
  "inviteeEmail"  text                NOT NULL,
  status          invite_statuses     NOT NULL DEFAULT 'PENDING',
  "inviteCode"    text                NOT NULL,
  roles           organization_roles[] NOT NULL DEFAULT '{}',
  "inviteMessage" varchar(1000),
  "expiresAt"     timestamptz         NOT NULL,
  "createdAt"     timestamptz         NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz         NOT NULL DEFAULT now()
);

-- 2.32 Announcement
CREATE TABLE "Announcement" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  content     text        NOT NULL,
  link        text,
  "linkText"  text,
  published   boolean     NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 2.33 Booking
CREATE TABLE "Booking" (
  id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text           NOT NULL,
  status                      booking_status NOT NULL DEFAULT 'DRAFT',
  description                 text           DEFAULT '',
  "activeSchedulerReference"  text,
  "creatorId"                 uuid           NOT NULL,
  "custodianUserId"           uuid,
  "custodianTeamMemberId"     uuid,
  "organizationId"            uuid           NOT NULL,
  "createdAt"                 timestamptz    NOT NULL DEFAULT now(),
  "updatedAt"                 timestamptz    NOT NULL DEFAULT now(),
  "from"                      timestamptz    NOT NULL,
  "to"                        timestamptz    NOT NULL,
  "originalFrom"              timestamptz,
  "originalTo"                timestamptz,
  "autoArchivedAt"            timestamptz,
  "cancellationReason"        text
);

-- 2.34 BookingSettings
CREATE TABLE "BookingSettings" (
  id                                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "bufferStartTime"                        integer     NOT NULL DEFAULT 0,
  "tagsRequired"                           boolean     NOT NULL DEFAULT false,
  "maxBookingLength"                       integer,
  "maxBookingLengthSkipClosedDays"         boolean     NOT NULL DEFAULT false,
  "autoArchiveBookings"                    boolean     NOT NULL DEFAULT false,
  "autoArchiveDays"                        integer     NOT NULL DEFAULT 2,
  "requireExplicitCheckinForAdmin"         boolean     NOT NULL DEFAULT false,
  "requireExplicitCheckinForSelfService"   boolean     NOT NULL DEFAULT false,
  "organizationId"                         uuid        NOT NULL UNIQUE,
  "createdAt"                              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                              timestamptz NOT NULL DEFAULT now()
);

-- 2.35 PartialBookingCheckin
CREATE TABLE "PartialBookingCheckin" (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "assetIds"          text[]      NOT NULL DEFAULT '{}',
  "checkinCount"      integer     NOT NULL,
  "checkinTimestamp"   timestamptz NOT NULL DEFAULT now(),
  "bookingId"         uuid        NOT NULL,
  "checkedInById"     uuid        NOT NULL,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

-- 2.36 KitCustody
CREATE TABLE "KitCustody" (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "custodianId" uuid        NOT NULL,
  "kitId"       uuid        NOT NULL UNIQUE,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

-- 2.37 AssetReminder
CREATE TABLE "AssetReminder" (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text        NOT NULL,
  message                     text        NOT NULL,
  "alertDateTime"             timestamptz NOT NULL,
  "activeSchedulerReference"  text,
  "organizationId"            uuid        NOT NULL,
  "assetId"                   uuid        NOT NULL,
  "createdById"               uuid        NOT NULL,
  "createdAt"                 timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                 timestamptz NOT NULL DEFAULT now()
);

-- 2.38 WorkingHours
CREATE TABLE "WorkingHours" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled          boolean     NOT NULL DEFAULT false,
  "weeklySchedule" jsonb       NOT NULL DEFAULT '{"0":{"isOpen":false},"1":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"2":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"3":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"4":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"5":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"6":{"isOpen":false}}',
  "organizationId" uuid        NOT NULL UNIQUE,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- 2.39 WorkingHoursOverride
CREATE TABLE "WorkingHoursOverride" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date             date        NOT NULL,
  "isOpen"         boolean     NOT NULL DEFAULT false,
  "openTime"       text,
  "closeTime"      text,
  reason           text,
  "workingHoursId" uuid        NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("workingHoursId", date)
);

-- 2.40 Update
CREATE TABLE "Update" (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text                NOT NULL,
  content       text                NOT NULL,
  url           text,
  "imageUrl"    text,
  "publishDate" timestamptz         NOT NULL,
  status        update_status       NOT NULL DEFAULT 'DRAFT',
  "targetRoles" organization_roles[] NOT NULL DEFAULT '{}',
  "clickCount"  integer             NOT NULL DEFAULT 0,
  "viewCount"   integer             NOT NULL DEFAULT 0,
  "createdById" uuid                NOT NULL,
  "createdAt"   timestamptz         NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz         NOT NULL DEFAULT now()
);

-- 2.41 UserUpdateRead
CREATE TABLE "UserUpdateRead" (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"   uuid        NOT NULL,
  "updateId" uuid        NOT NULL,
  "readAt"   timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("userId", "updateId")
);

-- 2.42 AuditSession
CREATE TABLE "AuditSession" (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text         NOT NULL,
  description                 text,
  "targetId"                  text,
  status                      audit_status NOT NULL DEFAULT 'PENDING',
  "scopeMeta"                 jsonb,
  "expectedAssetCount"        integer      NOT NULL DEFAULT 0,
  "foundAssetCount"           integer      NOT NULL DEFAULT 0,
  "missingAssetCount"         integer      NOT NULL DEFAULT 0,
  "unexpectedAssetCount"      integer      NOT NULL DEFAULT 0,
  "startedAt"                 timestamptz,
  "dueDate"                   timestamptz,
  "completedAt"               timestamptz,
  "cancelledAt"               timestamptz,
  "activeSchedulerReference"  text,
  "createdById"               uuid         NOT NULL,
  "organizationId"            uuid         NOT NULL,
  "createdAt"                 timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"                 timestamptz  NOT NULL DEFAULT now()
);

-- 2.43 AuditAssignment
CREATE TABLE "AuditAssignment" (
  id               uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "auditSessionId" uuid                  NOT NULL,
  "userId"         uuid                  NOT NULL,
  role             audit_assignment_role,
  "createdAt"      timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz           NOT NULL DEFAULT now(),

  UNIQUE ("auditSessionId", "userId")
);

-- 2.44 AuditAsset
CREATE TABLE "AuditAsset" (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  "auditSessionId" uuid              NOT NULL,
  "assetId"        uuid              NOT NULL,
  expected         boolean           NOT NULL DEFAULT true,
  status           audit_asset_status NOT NULL DEFAULT 'PENDING',
  "scannedById"    uuid,
  "scannedAt"      timestamptz,
  metadata         jsonb,
  "createdAt"      timestamptz       NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz       NOT NULL DEFAULT now(),

  UNIQUE ("auditSessionId", "assetId")
);

-- 2.45 AuditScan
CREATE TABLE "AuditScan" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "auditSessionId" uuid        NOT NULL,
  "auditAssetId"   uuid,
  "assetId"        uuid,
  "scannedById"    uuid,
  code             text,
  metadata         jsonb,
  "scannedAt"      timestamptz NOT NULL DEFAULT now(),
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

-- 2.46 AuditNote
CREATE TABLE "AuditNote" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content          text        NOT NULL,
  type             note_type   NOT NULL DEFAULT 'COMMENT',
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "userId"         uuid,
  "auditSessionId" uuid        NOT NULL,
  "auditAssetId"   uuid
);

-- 2.47 AuditImage
CREATE TABLE "AuditImage" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "imageUrl"       text        NOT NULL,
  "thumbnailUrl"   text,
  description      text,
  "auditSessionId" uuid        NOT NULL,
  "auditAssetId"   uuid,
  "uploadedById"   uuid,
  "organizationId" uuid        NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- 2.48 RoleChangeLog
CREATE TABLE "RoleChangeLog" (
  id               uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  "previousRole"   organization_roles NOT NULL,
  "newRole"        organization_roles NOT NULL,
  "createdAt"      timestamptz        NOT NULL DEFAULT now(),
  "userId"         uuid               NOT NULL,
  "changedById"    uuid               NOT NULL,
  "organizationId" uuid               NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2.M  Many-to-many join tables (Prisma implicit relations)
-- ---------------------------------------------------------------------------

-- Asset <-> Tag
CREATE TABLE "_AssetToTag" (
  "A" uuid NOT NULL,  -- Asset id
  "B" uuid NOT NULL,  -- Tag id
  PRIMARY KEY ("A", "B")
);

-- Asset <-> Booking
CREATE TABLE "_AssetToBooking" (
  "A" uuid NOT NULL,  -- Asset id
  "B" uuid NOT NULL,  -- Booking id
  PRIMARY KEY ("A", "B")
);

-- Category <-> CustomField
CREATE TABLE "_CategoryToCustomField" (
  "A" uuid NOT NULL,  -- Category id
  "B" uuid NOT NULL,  -- CustomField id
  PRIMARY KEY ("A", "B")
);

-- Tag <-> Booking
CREATE TABLE "_TagToBooking" (
  "A" uuid NOT NULL,  -- Tag id (actually Booking)
  "B" uuid NOT NULL,  -- Booking id (actually Tag)
  PRIMARY KEY ("A", "B")
);

-- AssetReminder <-> TeamMember
CREATE TABLE "_AssetReminderToTeamMember" (
  "A" uuid NOT NULL,  -- AssetReminder id
  "B" uuid NOT NULL,  -- TeamMember id
  PRIMARY KEY ("A", "B")
);

-- Role <-> User
CREATE TABLE "_RoleToUser" (
  "A" uuid NOT NULL,  -- Role id
  "B" uuid NOT NULL,  -- User id
  PRIMARY KEY ("A", "B")
);

-- ---------------------------------------------------------------------------
-- 3. Foreign key constraints
-- ---------------------------------------------------------------------------

-- Tier
ALTER TABLE "Tier"
  ADD CONSTRAINT "Tier_tierLimitId_fkey"
    FOREIGN KEY ("tierLimitId") REFERENCES "TierLimit"(id);

-- User
ALTER TABLE "User"
  ADD CONSTRAINT "User_lastSelectedOrganizationId_fkey"
    FOREIGN KEY ("lastSelectedOrganizationId") REFERENCES "Organization"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "User_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "Tier"(id);

-- UserContact
ALTER TABLE "UserContact"
  ADD CONSTRAINT "UserContact_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- UserBusinessIntel
ALTER TABLE "UserBusinessIntel"
  ADD CONSTRAINT "UserBusinessIntel_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Organization
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Organization_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"(id),
  ADD CONSTRAINT "Organization_ssoDetailsId_fkey"
    FOREIGN KEY ("ssoDetailsId") REFERENCES "SsoDetails"(id);

-- Image
ALTER TABLE "Image"
  ADD CONSTRAINT "Image_ownerOrgId_fkey"
    FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Image_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE;

-- Location
ALTER TABLE "Location"
  ADD CONSTRAINT "Location_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"(id),
  ADD CONSTRAINT "Location_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Location_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Location_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Location"(id)
    ON DELETE SET NULL;

-- Category
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Category_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Kit
ALTER TABLE "Kit"
  ADD CONSTRAINT "Kit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Kit_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id),
  ADD CONSTRAINT "Kit_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"(id),
  ADD CONSTRAINT "Kit_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id);

-- Asset
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Asset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Asset_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"(id),
  ADD CONSTRAINT "Asset_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id),
  ADD CONSTRAINT "Asset_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id);

-- AssetFilterPreset
ALTER TABLE "AssetFilterPreset"
  ADD CONSTRAINT "AssetFilterPreset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "AssetFilterPreset_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"(id)
    ON DELETE CASCADE;

-- AssetIndexSettings
ALTER TABLE "AssetIndexSettings"
  ADD CONSTRAINT "AssetIndexSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetIndexSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Tag
ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Tag_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Note
ALTER TABLE "Note"
  ADD CONSTRAINT "Note_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Note_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- BookingNote
ALTER TABLE "BookingNote"
  ADD CONSTRAINT "BookingNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BookingNote_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- LocationNote
ALTER TABLE "LocationNote"
  ADD CONSTRAINT "LocationNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LocationNote_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Qr
ALTER TABLE "Qr"
  ADD CONSTRAINT "Qr_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Qr_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Qr_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Qr_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Qr_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PrintBatch"(id)
    ON DELETE SET NULL;

-- Barcode
ALTER TABLE "Barcode"
  ADD CONSTRAINT "Barcode_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Barcode_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Barcode_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ReportFound
ALTER TABLE "ReportFound"
  ADD CONSTRAINT "ReportFound_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportFound_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Scan
ALTER TABLE "Scan"
  ADD CONSTRAINT "Scan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Scan_qrId_fkey"
    FOREIGN KEY ("qrId") REFERENCES "Qr"(id)
    ON DELETE SET NULL;

-- TeamMember
ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Custody
ALTER TABLE "Custody"
  ADD CONSTRAINT "Custody_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"(id),
  ADD CONSTRAINT "Custody_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- UserOrganization
ALTER TABLE "UserOrganization"
  ADD CONSTRAINT "UserOrganization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserOrganization_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CustomField
ALTER TABLE "CustomField"
  ADD CONSTRAINT "CustomField_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomField_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE;

-- AssetCustomFieldValue
ALTER TABLE "AssetCustomFieldValue"
  ADD CONSTRAINT "AssetCustomFieldValue_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CustomTierLimit
ALTER TABLE "CustomTierLimit"
  ADD CONSTRAINT "CustomTierLimit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL;

-- Invite
ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_inviterId_fkey"
    FOREIGN KEY ("inviterId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_inviteeUserId_fkey"
    FOREIGN KEY ("inviteeUserId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"(id);

-- Booking
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_custodianUserId_fkey"
    FOREIGN KEY ("custodianUserId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_custodianTeamMemberId_fkey"
    FOREIGN KEY ("custodianTeamMemberId") REFERENCES "TeamMember"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- BookingSettings
ALTER TABLE "BookingSettings"
  ADD CONSTRAINT "BookingSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- PartialBookingCheckin
ALTER TABLE "PartialBookingCheckin"
  ADD CONSTRAINT "PartialBookingCheckin_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "PartialBookingCheckin_checkedInById_fkey"
    FOREIGN KEY ("checkedInById") REFERENCES "User"(id);

-- KitCustody
ALTER TABLE "KitCustody"
  ADD CONSTRAINT "KitCustody_custodianId_fkey"
    FOREIGN KEY ("custodianId") REFERENCES "TeamMember"(id),
  ADD CONSTRAINT "KitCustody_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AssetReminder
ALTER TABLE "AssetReminder"
  ADD CONSTRAINT "AssetReminder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id),
  ADD CONSTRAINT "AssetReminder_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "AssetReminder_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id);

-- WorkingHours
ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkingHoursOverride
ALTER TABLE "WorkingHoursOverride"
  ADD CONSTRAINT "WorkingHoursOverride_workingHoursId_fkey"
    FOREIGN KEY ("workingHoursId") REFERENCES "WorkingHours"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Update
ALTER TABLE "Update"
  ADD CONSTRAINT "Update_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- UserUpdateRead
ALTER TABLE "UserUpdateRead"
  ADD CONSTRAINT "UserUpdateRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserUpdateRead_updateId_fkey"
    FOREIGN KEY ("updateId") REFERENCES "Update"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditSession
ALTER TABLE "AuditSession"
  ADD CONSTRAINT "AuditSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id),
  ADD CONSTRAINT "AuditSession_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditAssignment
ALTER TABLE "AuditAssignment"
  ADD CONSTRAINT "AuditAssignment_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditAsset
ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAsset_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAsset_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditScan
ALTER TABLE "AuditScan"
  ADD CONSTRAINT "AuditScan_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditNote
ALTER TABLE "AuditNote"
  ADD CONSTRAINT "AuditNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditNote_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditNote_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditImage
ALTER TABLE "AuditImage"
  ADD CONSTRAINT "AuditImage_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RoleChangeLog
ALTER TABLE "RoleChangeLog"
  ADD CONSTRAINT "RoleChangeLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id),
  ADD CONSTRAINT "RoleChangeLog_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"(id),
  ADD CONSTRAINT "RoleChangeLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id);

-- Join table FKs
ALTER TABLE "_AssetToTag"
  ADD CONSTRAINT "_AssetToTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Asset"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetToTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_AssetToBooking"
  ADD CONSTRAINT "_AssetToBooking_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Asset"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetToBooking_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Booking"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_CategoryToCustomField"
  ADD CONSTRAINT "_CategoryToCustomField_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Category"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_CategoryToCustomField_B_fkey"
    FOREIGN KEY ("B") REFERENCES "CustomField"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_TagToBooking"
  ADD CONSTRAINT "_TagToBooking_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Booking"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_TagToBooking_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_AssetReminderToTeamMember"
  ADD CONSTRAINT "_AssetReminderToTeamMember_A_fkey"
    FOREIGN KEY ("A") REFERENCES "AssetReminder"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetReminderToTeamMember_B_fkey"
    FOREIGN KEY ("B") REFERENCES "TeamMember"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_RoleToUser"
  ADD CONSTRAINT "_RoleToUser_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Role"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_RoleToUser_B_fkey"
    FOREIGN KEY ("B") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Additional unique constraints (named)
-- ---------------------------------------------------------------------------

ALTER TABLE "Asset"
  ADD CONSTRAINT "asset_org_sequential_unique"
    UNIQUE ("organizationId", "sequentialId");

ALTER TABLE "AssetFilterPreset"
  ADD CONSTRAINT "asset_filter_presets_owner_name_unique"
    UNIQUE ("organizationId", "ownerId", name);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------

-- Image
CREATE INDEX "Image_ownerOrgId_idx" ON "Image" ("ownerOrgId");
CREATE INDEX "Image_userId_idx" ON "Image" ("userId");

-- User
CREATE INDEX "User_firstName_lastName_idx" ON "User" ("firstName", "lastName");
CREATE INDEX "User_tierId_idx" ON "User" ("tierId");
CREATE INDEX "User_lastSelectedOrganizationId_idx" ON "User" ("lastSelectedOrganizationId");

-- UserContact
CREATE INDEX "UserContact_userId_idx" ON "UserContact" ("userId");
CREATE INDEX "UserContact_phone_idx" ON "UserContact" (phone);
CREATE INDEX "UserContact_city_stateProvince_idx" ON "UserContact" (city, "stateProvince");
CREATE INDEX "UserContact_countryRegion_idx" ON "UserContact" ("countryRegion");
CREATE INDEX "UserContact_zipPostalCode_idx" ON "UserContact" ("zipPostalCode");
CREATE INDEX "UserContact_city_countryRegion_idx" ON "UserContact" (city, "countryRegion");

-- UserBusinessIntel
CREATE INDEX "UserBusinessIntel_userId_idx" ON "UserBusinessIntel" ("userId");
CREATE INDEX "UserBusinessIntel_companyName_idx" ON "UserBusinessIntel" ("companyName");
CREATE INDEX "UserBusinessIntel_jobTitle_idx" ON "UserBusinessIntel" ("jobTitle");
CREATE INDEX "UserBusinessIntel_teamSize_idx" ON "UserBusinessIntel" ("teamSize");

-- Asset
CREATE INDEX "Asset_title_description_gin_idx" ON "Asset" USING gin (title gin_trgm_ops, description gin_trgm_ops);
CREATE INDEX "Asset_organizationId_compound_idx" ON "Asset" ("organizationId", title, status, "availableToBook");
CREATE INDEX "Asset_status_organizationId_idx" ON "Asset" (status, "organizationId");
CREATE INDEX "Asset_createdAt_organizationId_idx" ON "Asset" ("createdAt", "organizationId");
CREATE INDEX "Asset_valuation_organizationId_idx" ON "Asset" (value, "organizationId");
CREATE INDEX "Asset_categoryId_organizationId_idx" ON "Asset" ("categoryId", "organizationId");
CREATE INDEX "Asset_locationId_organizationId_idx" ON "Asset" ("locationId", "organizationId");
CREATE INDEX "Asset_kitId_organizationId_idx" ON "Asset" ("kitId", "organizationId");
CREATE INDEX "Asset_sequentialId_idx" ON "Asset" ("sequentialId");
CREATE INDEX "Asset_userId_idx" ON "Asset" ("userId");

-- AssetFilterPreset
CREATE INDEX "asset_filter_presets_owner_lookup_idx" ON "AssetFilterPreset" ("organizationId", "ownerId");

-- AssetIndexSettings
CREATE INDEX "AssetIndexSettings_organizationId_idx" ON "AssetIndexSettings" ("organizationId");

-- Category
CREATE INDEX "Category_organizationId_idx" ON "Category" ("organizationId");
CREATE INDEX "Category_userId_idx" ON "Category" ("userId");

-- Tag
CREATE INDEX "Tag_organizationId_idx" ON "Tag" ("organizationId");
CREATE INDEX "Tag_userId_idx" ON "Tag" ("userId");

-- Note
CREATE INDEX "Note_assetId_idx" ON "Note" ("assetId");
CREATE INDEX "Note_userId_idx" ON "Note" ("userId");

-- BookingNote
CREATE INDEX "BookingNote_bookingId_idx" ON "BookingNote" ("bookingId");
CREATE INDEX "BookingNote_userId_idx" ON "BookingNote" ("userId");

-- LocationNote
CREATE INDEX "LocationNote_locationId_idx" ON "LocationNote" ("locationId");
CREATE INDEX "LocationNote_userId_idx" ON "LocationNote" ("userId");

-- Qr
CREATE INDEX "Qr_assetId_idx" ON "Qr" ("assetId");
CREATE INDEX "Qr_kitId_idx" ON "Qr" ("kitId");
CREATE INDEX "Qr_userId_idx" ON "Qr" ("userId");
CREATE INDEX "Qr_organizationId_idx" ON "Qr" ("organizationId");
CREATE INDEX "Qr_batchId_idx" ON "Qr" ("batchId");

-- Barcode
CREATE INDEX "Barcode_organizationId_value_idx" ON "Barcode" ("organizationId", value);
CREATE INDEX "Barcode_assetId_idx" ON "Barcode" ("assetId");
CREATE INDEX "Barcode_kitId_idx" ON "Barcode" ("kitId");
CREATE INDEX "Barcode_organizationId_idx" ON "Barcode" ("organizationId");

-- ReportFound
CREATE INDEX "ReportFound_assetId_idx" ON "ReportFound" ("assetId");
CREATE INDEX "ReportFound_kitId_idx" ON "ReportFound" ("kitId");

-- Scan
CREATE INDEX "Scan_qrId_idx" ON "Scan" ("qrId");
CREATE INDEX "Scan_userId_idx" ON "Scan" ("userId");

-- Location
CREATE INDEX "Location_organizationId_idx" ON "Location" ("organizationId");
CREATE INDEX "Location_userId_idx" ON "Location" ("userId");
CREATE INDEX "Location_organizationId_parentId_idx" ON "Location" ("organizationId", "parentId");

-- TeamMember
CREATE INDEX "TeamMember_name_gin_idx" ON "TeamMember" USING gin (name gin_trgm_ops);
CREATE INDEX "TeamMember_organizationId_idx" ON "TeamMember" ("organizationId");
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember" ("userId");

-- Custody
CREATE INDEX "Custody_assetId_teamMemberId_idx" ON "Custody" ("assetId", "teamMemberId");
CREATE INDEX "Custody_teamMemberId_idx" ON "Custody" ("teamMemberId");

-- Organization
CREATE INDEX "Organization_userId_idx" ON "Organization" ("userId");
CREATE INDEX "Organization_ssoDetailsId_idx" ON "Organization" ("ssoDetailsId");

-- UserOrganization
CREATE INDEX "UserOrganization_organizationId_idx" ON "UserOrganization" ("organizationId");

-- CustomField
CREATE INDEX "CustomField_organizationId_idx" ON "CustomField" ("organizationId");
CREATE INDEX "CustomField_userId_idx" ON "CustomField" ("userId");
CREATE INDEX "CustomField_organizationId_deletedAt_idx" ON "CustomField" ("organizationId", "deletedAt");

-- AssetCustomFieldValue
CREATE INDEX "AssetCustomFieldValue_lookup_idx" ON "AssetCustomFieldValue" ("assetId", "customFieldId");
CREATE INDEX "AssetCustomFieldValue_customFieldId_idx" ON "AssetCustomFieldValue" ("customFieldId");

-- Invite
CREATE INDEX "Invite_inviteeUserId_idx" ON "Invite" ("inviteeUserId");
CREATE INDEX "Invite_inviterId_idx" ON "Invite" ("inviterId");
CREATE INDEX "Invite_organizationId_idx" ON "Invite" ("organizationId");
CREATE INDEX "Invite_teamMemberId_idx" ON "Invite" ("teamMemberId");

-- Booking
CREATE INDEX "Booking_creatorId_idx" ON "Booking" ("creatorId");
CREATE INDEX "Booking_custodianTeamMemberId_idx" ON "Booking" ("custodianTeamMemberId");
CREATE INDEX "Booking_custodianUserId_idx" ON "Booking" ("custodianUserId");
CREATE INDEX "Booking_organizationId_idx" ON "Booking" ("organizationId");

-- BookingSettings
CREATE INDEX "BookingSettings_organizationId_idx" ON "BookingSettings" ("organizationId");

-- PartialBookingCheckin
CREATE INDEX "PartialBookingCheckin_bookingId_idx" ON "PartialBookingCheckin" ("bookingId");
CREATE INDEX "PartialBookingCheckin_checkedInById_idx" ON "PartialBookingCheckin" ("checkedInById");
CREATE INDEX "PartialBookingCheckin_checkinTimestamp_idx" ON "PartialBookingCheckin" ("checkinTimestamp");
CREATE INDEX "PartialBookingCheckin_bookingId_checkinTimestamp_idx" ON "PartialBookingCheckin" ("bookingId", "checkinTimestamp");

-- Kit
CREATE INDEX "Kit_createdById_idx" ON "Kit" ("createdById");
CREATE INDEX "Kit_organizationId_idx" ON "Kit" ("organizationId");
CREATE INDEX "Kit_categoryId_organizationId_idx" ON "Kit" ("categoryId", "organizationId");
CREATE INDEX "Kit_categoryId_organizationId_createdAt_idx" ON "Kit" ("categoryId", "organizationId", "createdAt");
CREATE INDEX "Kit_categoryId_organizationId_name_idx" ON "Kit" ("categoryId", "organizationId", name);
CREATE INDEX "Kit_categoryId_organizationId_status_idx" ON "Kit" ("categoryId", "organizationId", status);

-- KitCustody
CREATE INDEX "KitCustody_custodianId_idx" ON "KitCustody" ("custodianId");

-- AssetReminder
CREATE INDEX "AssetReminder_assetId_alertDateTime_idx" ON "AssetReminder" ("assetId", "alertDateTime");
CREATE INDEX "AssetReminder_name_message_gin_idx" ON "AssetReminder" USING gin (name gin_trgm_ops, message gin_trgm_ops);
CREATE INDEX "AssetReminder_organizationId_alertDateTime_assetId_idx" ON "AssetReminder" ("organizationId", "alertDateTime", "assetId");
CREATE INDEX "AssetReminder_alertDateTime_activeSchedulerReference_idx" ON "AssetReminder" ("alertDateTime", "activeSchedulerReference");
CREATE INDEX "AssetReminder_createdById_idx" ON "AssetReminder" ("createdById");

-- WorkingHours
CREATE INDEX "WorkingHours_organizationId_idx" ON "WorkingHours" ("organizationId");

-- WorkingHoursOverride
CREATE INDEX "WorkingHoursOverride_workingHoursId_date_idx" ON "WorkingHoursOverride" ("workingHoursId", date);
CREATE INDEX "WorkingHoursOverride_date_isOpen_idx" ON "WorkingHoursOverride" (date, "isOpen");

-- Update
CREATE INDEX "Update_status_publishDate_idx" ON "Update" (status, "publishDate");
CREATE INDEX "Update_publishDate_idx" ON "Update" ("publishDate");
CREATE INDEX "Update_createdById_idx" ON "Update" ("createdById");

-- UserUpdateRead
CREATE INDEX "UserUpdateRead_userId_idx" ON "UserUpdateRead" ("userId");
CREATE INDEX "UserUpdateRead_updateId_idx" ON "UserUpdateRead" ("updateId");
CREATE INDEX "UserUpdateRead_readAt_idx" ON "UserUpdateRead" ("readAt");

-- AuditSession
CREATE INDEX "AuditSession_organizationId_status_idx" ON "AuditSession" ("organizationId", status);
CREATE INDEX "AuditSession_createdById_idx" ON "AuditSession" ("createdById");
CREATE INDEX "AuditSession_status_createdAt_idx" ON "AuditSession" (status, "createdAt");

-- AuditAssignment
CREATE INDEX "AuditAssignment_userId_idx" ON "AuditAssignment" ("userId");

-- AuditAsset
CREATE INDEX "AuditAsset_status_idx" ON "AuditAsset" (status);
CREATE INDEX "AuditAsset_scannedById_idx" ON "AuditAsset" ("scannedById");

-- AuditScan
CREATE INDEX "AuditScan_auditSessionId_scannedAt_idx" ON "AuditScan" ("auditSessionId", "scannedAt");
CREATE INDEX "AuditScan_auditAssetId_idx" ON "AuditScan" ("auditAssetId");
CREATE INDEX "AuditScan_assetId_idx" ON "AuditScan" ("assetId");

-- AuditNote
CREATE INDEX "AuditNote_auditSessionId_idx" ON "AuditNote" ("auditSessionId");
CREATE INDEX "AuditNote_userId_idx" ON "AuditNote" ("userId");
CREATE INDEX "AuditNote_auditAssetId_idx" ON "AuditNote" ("auditAssetId");

-- AuditImage
CREATE INDEX "AuditImage_auditSessionId_idx" ON "AuditImage" ("auditSessionId");
CREATE INDEX "AuditImage_auditAssetId_idx" ON "AuditImage" ("auditAssetId");
CREATE INDEX "AuditImage_organizationId_idx" ON "AuditImage" ("organizationId");
CREATE INDEX "AuditImage_uploadedById_idx" ON "AuditImage" ("uploadedById");

-- RoleChangeLog
CREATE INDEX "RoleChangeLog_userId_organizationId_idx" ON "RoleChangeLog" ("userId", "organizationId");
CREATE INDEX "RoleChangeLog_organizationId_createdAt_idx" ON "RoleChangeLog" ("organizationId", "createdAt");

-- Join table indexes
CREATE INDEX "_AssetToTag_B_idx" ON "_AssetToTag" ("B");
CREATE INDEX "_AssetToBooking_B_idx" ON "_AssetToBooking" ("B");
CREATE INDEX "_CategoryToCustomField_B_idx" ON "_CategoryToCustomField" ("B");
CREATE INDEX "_TagToBooking_B_idx" ON "_TagToBooking" ("B");
CREATE INDEX "_AssetReminderToTeamMember_B_idx" ON "_AssetReminderToTeamMember" ("B");
CREATE INDEX "_RoleToUser_B_idx" ON "_RoleToUser" ("B");
