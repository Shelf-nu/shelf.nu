-- Page titles for web links in custom fields: one row per workspace and link,
-- holding the fetched title, the fetch schedule, and a name people can give
-- the link. Rows are created as links are viewed, so no backfill is needed.

-- CreateEnum
CREATE TYPE "LinkPreviewOutcome" AS ENUM ('TITLE', 'NO_TITLE', 'SIGN_IN', 'BLOCKED', 'UNREACHABLE');

-- CreateTable
CREATE TABLE "LinkPreview" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pageTitle" TEXT,
    "outcome" "LinkPreviewOutcome",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3),
    "nextFetchAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "customTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "LinkPreview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LinkPreview_url_length" CHECK (char_length("url") <= 2048)
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkPreview_organizationId_url_key" ON "LinkPreview"("organizationId", "url");

-- AddForeignKey
ALTER TABLE "LinkPreview" ADD CONSTRAINT "LinkPreview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "LinkPreview" ENABLE ROW LEVEL SECURITY;
