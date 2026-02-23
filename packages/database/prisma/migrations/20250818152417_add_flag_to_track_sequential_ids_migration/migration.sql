-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "hasSequentialIdsMigrated" BOOLEAN NOT NULL DEFAULT false;
