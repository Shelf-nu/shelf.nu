-- CreateEnum
CREATE TYPE "public"."UpdateStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- DropIndex
DROP INDEX "public"."_AssetToBooking_Asset_idx";

-- DropIndex
DROP INDEX "public"."_AssetToTag_asset_idx";

-- CreateTable
CREATE TABLE "public"."Update" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishDate" TIMESTAMP(3) NOT NULL,
    "status" "public"."UpdateStatus" NOT NULL DEFAULT 'DRAFT',
    "targetRoles" "public"."OrganizationRoles"[],
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserUpdateRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserUpdateRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Update_status_publishDate_idx" ON "public"."Update"("status", "publishDate");

-- CreateIndex
CREATE INDEX "Update_publishDate_idx" ON "public"."Update"("publishDate");

-- CreateIndex
CREATE INDEX "Update_createdById_idx" ON "public"."Update"("createdById");

-- CreateIndex
CREATE INDEX "UserUpdateRead_userId_idx" ON "public"."UserUpdateRead"("userId");

-- CreateIndex
CREATE INDEX "UserUpdateRead_updateId_idx" ON "public"."UserUpdateRead"("updateId");

-- CreateIndex
CREATE INDEX "UserUpdateRead_readAt_idx" ON "public"."UserUpdateRead"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserUpdateRead_userId_updateId_key" ON "public"."UserUpdateRead"("userId", "updateId");

-- AddForeignKey
ALTER TABLE "public"."Update" ADD CONSTRAINT "Update_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserUpdateRead" ADD CONSTRAINT "UserUpdateRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserUpdateRead" ADD CONSTRAINT "UserUpdateRead_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "public"."Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "Update" ENABLE row level security;
ALTER TABLE "UserUpdateRead" ENABLE row level security;