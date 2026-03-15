-- =============================================================================
-- 002_strip_shelf_billing_and_auth.sql
-- Strip Shelf.nu billing (Stripe tiers) and auth (SSO) models
-- Drops: Tier, TierLimit, CustomTierLimit, SsoDetails, Announcement,
--         UserBusinessIntel, _RoleToUser join table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop indexes on columns/tables being removed
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "User_tierId_idx";
DROP INDEX IF EXISTS "Organization_ssoDetailsId_idx";
DROP INDEX IF EXISTS "UserBusinessIntel_userId_idx";
DROP INDEX IF EXISTS "UserBusinessIntel_companyName_idx";
DROP INDEX IF EXISTS "UserBusinessIntel_jobTitle_idx";
DROP INDEX IF EXISTS "UserBusinessIntel_teamSize_idx";
DROP INDEX IF EXISTS "_RoleToUser_B_idx";

-- ---------------------------------------------------------------------------
-- 2. Drop foreign key constraints referencing tables being dropped
-- ---------------------------------------------------------------------------

-- User → Tier
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_tierId_fkey";

-- Tier → TierLimit
ALTER TABLE "Tier" DROP CONSTRAINT IF EXISTS "Tier_tierLimitId_fkey";

-- Organization → SsoDetails
ALTER TABLE "Organization" DROP CONSTRAINT IF EXISTS "Organization_ssoDetailsId_fkey";

-- CustomTierLimit → User
ALTER TABLE "CustomTierLimit" DROP CONSTRAINT IF EXISTS "CustomTierLimit_userId_fkey";

-- UserBusinessIntel → User
ALTER TABLE "UserBusinessIntel" DROP CONSTRAINT IF EXISTS "UserBusinessIntel_userId_fkey";

-- _RoleToUser join table FKs
ALTER TABLE "_RoleToUser" DROP CONSTRAINT IF EXISTS "_RoleToUser_A_fkey";
ALTER TABLE "_RoleToUser" DROP CONSTRAINT IF EXISTS "_RoleToUser_B_fkey";

-- ---------------------------------------------------------------------------
-- 3. Drop columns from User that reference stripped billing/auth
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "tierId",
  DROP COLUMN IF EXISTS "customerId",
  DROP COLUMN IF EXISTS "usedFreeTrial",
  DROP COLUMN IF EXISTS "skipSubscriptionCheck",
  DROP COLUMN IF EXISTS "hasUnpaidInvoice",
  DROP COLUMN IF EXISTS "warnForNoPaymentMethod";

-- ---------------------------------------------------------------------------
-- 4. Drop columns from Organization that reference stripped SSO
-- ---------------------------------------------------------------------------
ALTER TABLE "Organization"
  DROP COLUMN IF EXISTS "ssoDetailsId",
  DROP COLUMN IF EXISTS "enabledSso";

-- ---------------------------------------------------------------------------
-- 5. Drop tables
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "_RoleToUser";
DROP TABLE IF EXISTS "CustomTierLimit";
DROP TABLE IF EXISTS "Tier";
DROP TABLE IF EXISTS "TierLimit";
DROP TABLE IF EXISTS "SsoDetails";
DROP TABLE IF EXISTS "Announcement";
DROP TABLE IF EXISTS "UserBusinessIntel";

-- ---------------------------------------------------------------------------
-- 6. Drop orphaned enum type
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS tier_id;
