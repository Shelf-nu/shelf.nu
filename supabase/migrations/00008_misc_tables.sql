-- Miscellaneous tables: Announcement, Update, UserUpdateRead, RoleChangeLog

-- ============================================================
-- Announcement
-- ============================================================

CREATE TABLE "Announcement" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"      text        NOT NULL,
  "content"   text        NOT NULL,
  "link"      text,
  "linkText"  text,
  "published" boolean     NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Update (product updates / changelog)
-- ============================================================

CREATE TABLE "Update" (
  "id"          text                  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "title"       text                  NOT NULL,
  "content"     text                  NOT NULL,
  "url"         text,
  "imageUrl"    text,
  "publishDate" timestamptz           NOT NULL,
  "status"      "UpdateStatus"        NOT NULL DEFAULT 'DRAFT',
  "targetRoles" "OrganizationRoles"[] NOT NULL DEFAULT '{}',
  "clickCount"  integer               NOT NULL DEFAULT 0,
  "viewCount"   integer               NOT NULL DEFAULT 0,
  "createdById" text                  NOT NULL,
  "createdAt"   timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT "Update_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- UserUpdateRead (tracks which users read which updates)
-- ============================================================

CREATE TABLE "UserUpdateRead" (
  "id"       text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"   text        NOT NULL,
  "updateId" text        NOT NULL,
  "readAt"   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "UserUpdateRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "UserUpdateRead_updateId_fkey"
    FOREIGN KEY ("updateId") REFERENCES "Update"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "UserUpdateRead_userId_updateId_key"
    UNIQUE ("userId", "updateId")
);

-- ============================================================
-- RoleChangeLog (audit trail for role changes)
-- ============================================================

CREATE TABLE "RoleChangeLog" (
  "id"             text                PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "previousRole"   "OrganizationRoles" NOT NULL,
  "newRole"        "OrganizationRoles" NOT NULL,
  "createdAt"      timestamptz         NOT NULL DEFAULT now(),
  "userId"         text                NOT NULL,
  "changedById"    text                NOT NULL,
  "organizationId" text                NOT NULL,

  CONSTRAINT "RoleChangeLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "RoleChangeLog_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  CONSTRAINT "RoleChangeLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);
