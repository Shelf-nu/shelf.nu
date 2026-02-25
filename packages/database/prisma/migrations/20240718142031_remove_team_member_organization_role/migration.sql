/*
  Warnings:

  - The values [TEAM_MEMBER] on the enum `OrganizationRoles` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrganizationRoles_new" AS ENUM ('ADMIN', 'OWNER', 'SELF_SERVICE');
ALTER TABLE "UserOrganization" ALTER COLUMN "roles" TYPE "OrganizationRoles_new"[] USING ("roles"::text::"OrganizationRoles_new"[]);
ALTER TABLE "Invite" ALTER COLUMN "roles" TYPE "OrganizationRoles_new"[] USING ("roles"::text::"OrganizationRoles_new"[]);
ALTER TYPE "OrganizationRoles" RENAME TO "OrganizationRoles_old";
ALTER TYPE "OrganizationRoles_new" RENAME TO "OrganizationRoles";
DROP TYPE "OrganizationRoles_old";
COMMIT;
