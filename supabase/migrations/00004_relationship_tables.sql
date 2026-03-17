-- Relationship tables: QR, Scan, Barcode, Notes, PrintBatch, ReportFound, Invite

-- ============================================================
-- PrintBatch
-- ============================================================

CREATE TABLE "PrintBatch" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"      text        NOT NULL UNIQUE,
  "printed"   boolean     NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Qr
-- ============================================================

CREATE TABLE "Qr" (
  "id"              text              PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "version"         integer           NOT NULL DEFAULT 0,
  "errorCorrection" "ErrorCorrection" NOT NULL DEFAULT 'L',
  "assetId"         text,
  "kitId"           text,
  "userId"          text,
  "organizationId"  text,
  "batchId"         text,
  "createdAt"       timestamptz       NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT "Qr_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Qr_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Qr_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Qr_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Qr_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PrintBatch"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- Barcode
-- ============================================================

CREATE TABLE "Barcode" (
  "id"             text          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "value"          text          NOT NULL,
  "type"           "BarcodeType" NOT NULL DEFAULT 'Code128',
  "assetId"        text,
  "kitId"          text,
  "organizationId" text          NOT NULL,
  "createdAt"      timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT "Barcode_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Barcode_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Barcode_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Barcode_organizationId_value_key"
    UNIQUE ("organizationId", "value")
);

-- ============================================================
-- Scan
-- ============================================================

CREATE TABLE "Scan" (
  "id"                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "latitude"          text,
  "longitude"         text,
  "userAgent"         text,
  "userId"            text,
  "qrId"              text,
  "rawQrId"           text        NOT NULL,
  "manuallyGenerated" boolean     NOT NULL DEFAULT false,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "Scan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Scan_qrId_fkey"
    FOREIGN KEY ("qrId") REFERENCES "Qr"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- Note (for assets)
-- ============================================================

CREATE TABLE "Note" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "content"   text        NOT NULL,
  "type"      "NoteType"  NOT NULL DEFAULT 'COMMENT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "userId"    text,
  "assetId"   text        NOT NULL,

  CONSTRAINT "Note_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "Note_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- LocationNote
-- ============================================================

CREATE TABLE "LocationNote" (
  "id"         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "content"    text        NOT NULL,
  "type"       "NoteType"  NOT NULL DEFAULT 'COMMENT',
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  "userId"     text,
  "locationId" text        NOT NULL,

  CONSTRAINT "LocationNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "LocationNote_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- ReportFound
-- ============================================================

CREATE TABLE "ReportFound" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email"     text        NOT NULL,
  "content"   text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "assetId"   text,
  "kitId"     text,

  CONSTRAINT "ReportFound_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "ReportFound_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Invite
-- ============================================================

CREATE TABLE "Invite" (
  "id"             text                  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "inviterId"      text                  NOT NULL,
  "organizationId" text                  NOT NULL,
  "inviteeUserId"  text,
  "teamMemberId"   text                  NOT NULL,
  "inviteeEmail"   text                  NOT NULL,
  "status"         "InviteStatuses"      NOT NULL DEFAULT 'PENDING',
  "inviteCode"     text                  NOT NULL,
  "roles"          "OrganizationRoles"[] NOT NULL DEFAULT '{}',
  "inviteMessage"  varchar(1000),
  "expiresAt"      timestamptz           NOT NULL,
  "createdAt"      timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT "Invite_inviterId_fkey"
    FOREIGN KEY ("inviterId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Invite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Invite_inviteeUserId_fkey"
    FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Invite_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);
