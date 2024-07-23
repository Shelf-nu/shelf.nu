-- AlterTable
ALTER TABLE "SsoDetails" ADD COLUMN     "baseUserGroupId" TEXT;


-- Move the values from selfServiceGroupId to baseUserGroupId
UPDATE "SsoDetails"
SET "baseUserGroupId" = "selfServiceGroupId",
    "selfServiceGroupId" = '';