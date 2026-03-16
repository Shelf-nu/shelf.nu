-- Custom fields: CustomField, AssetCustomFieldValue, Category-CustomField junction

-- ============================================================
-- CustomField
-- ============================================================

CREATE TABLE "CustomField" (
  "id"             text             PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"           text             NOT NULL,
  "helpText"       text,
  "required"       boolean          NOT NULL DEFAULT false,
  "active"         boolean          NOT NULL DEFAULT true,
  "type"           "CustomFieldType" NOT NULL DEFAULT 'TEXT',
  "options"        text[]           NOT NULL DEFAULT '{}',
  "organizationId" text             NOT NULL,
  "userId"         text             NOT NULL,
  "createdAt"      timestamptz      NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz      NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz,

  CONSTRAINT "CustomField_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "CustomField_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ============================================================
-- AssetCustomFieldValue
-- ============================================================

CREATE TABLE "AssetCustomFieldValue" (
  "id"            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "value"         jsonb       NOT NULL,
  "assetId"       text        NOT NULL,
  "customFieldId" text        NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "AssetCustomFieldValue_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Category-CustomField junction (implicit many-to-many in Prisma)
-- ============================================================

CREATE TABLE "_CategoryToCustomField" (
  "A" text NOT NULL REFERENCES "Category"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "CustomField"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_CategoryToCustomField_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_CategoryToCustomField_B_index" ON "_CategoryToCustomField"("B");
