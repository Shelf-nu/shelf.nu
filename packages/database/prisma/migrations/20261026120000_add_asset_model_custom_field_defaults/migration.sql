-- Default custom field values on asset models. Each fills the matching field
-- on an asset only when that field is empty, at the moment the asset joins
-- the model.

CREATE TABLE "AssetModelCustomFieldDefault" (
    "id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "assetModelId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetModelCustomFieldDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetModelCustomFieldDefault_assetModelId_customFieldId_key" ON "AssetModelCustomFieldDefault"("assetModelId", "customFieldId");
CREATE INDEX "AssetModelCustomFieldDefault_customFieldId_idx" ON "AssetModelCustomFieldDefault"("customFieldId");

ALTER TABLE "AssetModelCustomFieldDefault" ADD CONSTRAINT "AssetModelCustomFieldDefault_assetModelId_fkey"
    FOREIGN KEY ("assetModelId") REFERENCES "AssetModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetModelCustomFieldDefault" ADD CONSTRAINT "AssetModelCustomFieldDefault_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "AssetModelCustomFieldDefault" ENABLE ROW LEVEL SECURITY;
