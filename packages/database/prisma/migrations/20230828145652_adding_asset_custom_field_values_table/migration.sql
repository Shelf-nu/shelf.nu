-- CreateTable
CREATE TABLE "AssetCustomFieldValue" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AssetCustomFieldValue" ADD CONSTRAINT "AssetCustomFieldValue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCustomFieldValue" ADD CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Enable RLS
ALTER TABLE "AssetCustomFieldValue" ENABLE row level security;