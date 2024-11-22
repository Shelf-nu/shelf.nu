-- Adds indexes to help with performance
-- 1. Primary Asset table indexes
CREATE INDEX IF NOT EXISTS "Asset_organizationId_compound_idx" 
ON public."Asset" ("organizationId", "title", status, "availableToBook");

CREATE INDEX IF NOT EXISTS "Asset_status_organizationId_idx" 
ON public."Asset" (status, "organizationId");

CREATE INDEX IF NOT EXISTS "Asset_createdAt_organizationId_idx" 
ON public."Asset" ("createdAt", "organizationId");

CREATE INDEX IF NOT EXISTS "Asset_valuation_organizationId_idx" 
ON public."Asset" (value, "organizationId");

-- 2. Relationship indexes
CREATE INDEX IF NOT EXISTS "Asset_categoryId_organizationId_idx" 
ON public."Asset" ("categoryId", "organizationId");

CREATE INDEX IF NOT EXISTS "Asset_locationId_organizationId_idx" 
ON public."Asset" ("locationId", "organizationId");

CREATE INDEX IF NOT EXISTS "Asset_kitId_organizationId_idx" 
ON public."Asset" ("kitId", "organizationId");

-- 3. Custom fields lookup optimization
CREATE INDEX IF NOT EXISTS "AssetCustomFieldValue_lookup_idx" 
ON public."AssetCustomFieldValue" ("assetId", "customFieldId");

-- 4. QR related index
CREATE INDEX IF NOT EXISTS "Qr_assetId_idx" 
ON public."Qr" ("assetId");

-- 5. Custody related indexes
CREATE INDEX IF NOT EXISTS "Custody_assetId_teamMemberId_idx" 
ON public."Custody" ("assetId", "teamMemberId");

-- 6. Tag relationship index
CREATE INDEX IF NOT EXISTS "_AssetToTag_asset_idx" 
ON public."_AssetToTag" ("A"); -- A is the Asset ID

-- 7. Booking relationship index
CREATE INDEX IF NOT EXISTS "_AssetToBooking_Asset_idx" 
ON public."_AssetToBooking" ("A", "B");