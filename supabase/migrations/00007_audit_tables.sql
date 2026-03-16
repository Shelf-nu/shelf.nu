-- Audit tables: AuditSession, AuditAssignment, AuditAsset, AuditScan,
-- AuditNote, AuditImage

-- ============================================================
-- AuditSession
-- ============================================================

CREATE TABLE "AuditSession" (
  "id"                       text          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"                     text          NOT NULL,
  "description"              text,
  "targetId"                 text,
  "status"                   "AuditStatus" NOT NULL DEFAULT 'PENDING',
  "scopeMeta"                jsonb,
  "expectedAssetCount"       integer       NOT NULL DEFAULT 0,
  "foundAssetCount"          integer       NOT NULL DEFAULT 0,
  "missingAssetCount"        integer       NOT NULL DEFAULT 0,
  "unexpectedAssetCount"     integer       NOT NULL DEFAULT 0,
  "startedAt"                timestamptz,
  "dueDate"                  timestamptz,
  "completedAt"              timestamptz,
  "cancelledAt"              timestamptz,
  "activeSchedulerReference" text,
  "createdById"              text          NOT NULL,
  "organizationId"           text          NOT NULL,
  "createdAt"                timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT "AuditSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "AuditSession_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- AuditAssignment
-- ============================================================

CREATE TABLE "AuditAssignment" (
  "id"             text                   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "auditSessionId" text                   NOT NULL,
  "userId"         text                   NOT NULL,
  "role"           "AuditAssignmentRole",
  "createdAt"      timestamptz            NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz            NOT NULL DEFAULT now(),

  CONSTRAINT "AuditAssignment_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditAssignment_auditSessionId_userId_key"
    UNIQUE ("auditSessionId", "userId")
);

-- ============================================================
-- AuditAsset
-- ============================================================

CREATE TABLE "AuditAsset" (
  "id"             text               PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "auditSessionId" text               NOT NULL,
  "assetId"        text               NOT NULL,
  "expected"       boolean            NOT NULL DEFAULT true,
  "status"         "AuditAssetStatus" NOT NULL DEFAULT 'PENDING',
  "scannedById"    text,
  "scannedAt"      timestamptz,
  "metadata"       jsonb,
  "createdAt"      timestamptz        NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz        NOT NULL DEFAULT now(),

  CONSTRAINT "AuditAsset_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditAsset_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditAsset_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditAsset_auditSessionId_assetId_key"
    UNIQUE ("auditSessionId", "assetId")
);

-- ============================================================
-- AuditScan
-- ============================================================

CREATE TABLE "AuditScan" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "auditSessionId" text        NOT NULL,
  "auditAssetId"   text,
  "assetId"        text,
  "scannedById"    text,
  "code"           text,
  "metadata"       jsonb,
  "scannedAt"      timestamptz NOT NULL DEFAULT now(),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "AuditScan_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditScan_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditScan_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditScan_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- AuditNote
-- ============================================================

CREATE TABLE "AuditNote" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "content"        text        NOT NULL,
  "type"           "NoteType"  NOT NULL DEFAULT 'COMMENT',
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "userId"         text,
  "auditSessionId" text        NOT NULL,
  "auditAssetId"   text,

  CONSTRAINT "AuditNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditNote_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditNote_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ============================================================
-- AuditImage
-- ============================================================

CREATE TABLE "AuditImage" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "imageUrl"       text        NOT NULL,
  "thumbnailUrl"   text,
  "description"    text,
  "auditSessionId" text        NOT NULL,
  "auditAssetId"   text,
  "uploadedById"   text,
  "organizationId" text        NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "AuditImage_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AuditImage_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditImage_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "AuditImage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);
