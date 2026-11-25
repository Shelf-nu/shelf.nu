-- Problem reports ("Report a problem" on an asset) get their own table. A
-- report is one row here plus the asset history line (a "Note" of type
-- UPDATE) it has always written; the row links to that note.

-- CreateTable
CREATE TABLE "ProblemReport" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reporterId" TEXT,
    "noteId" TEXT,

    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProblemReport_noteId_key" ON "ProblemReport"("noteId");

-- CreateIndex
CREATE INDEX "ProblemReport_assetId_idx" ON "ProblemReport"("assetId");

-- CreateIndex
CREATE INDEX "ProblemReport_reporterId_idx" ON "ProblemReport"("reporterId");

-- CreateIndex
CREATE INDEX "ProblemReport_organizationId_reporterId_createdAt_idx" ON "ProblemReport"("organizationId", "reporterId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "ProblemReport" ENABLE ROW LEVEL SECURITY;

-- Records each problem report in the activity log. Nothing in this migration
-- uses the new value.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ASSET_PROBLEM_REPORTED';

-- Copies the reports that exist only as history lines. A report line is an
-- UPDATE note of exactly this shape, written by `buildProblemReportNote`:
--
--   {% link to="/settings/team/users/<id>" text="<name>" /%} reported a problem: {% name text="<text>" /%}
--
-- The whole line must match, so a note that merely mentions the phrase is
-- left alone. The stored text has double quotes written as &quot; (turned
-- back here) and line breaks folded into spaces (kept: the original breaks
-- are not stored anywhere).
--
-- Safe to run again: a note that already has its row is skipped.
INSERT INTO "ProblemReport" (
    "id", "content", "createdAt", "updatedAt",
    "assetId", "organizationId", "reporterId", "noteId"
)
SELECT
    gen_random_uuid()::text,
    replace(
        substring(
            n."content"
            from '^\{% link to="/settings/team/users/[^"]+" text="[^"]*" /%\} reported a problem: \{% name text="(.*)" /%\}$'
        ),
        '&quot;',
        '"'
    ),
    n."createdAt",
    n."createdAt",
    n."assetId",
    a."organizationId",
    n."userId",
    n."id"
FROM "Note" n
JOIN "Asset" a ON a."id" = n."assetId"
WHERE n."type" = 'UPDATE'
  AND n."content" ~ '^\{% link to="/settings/team/users/[^"]+" text="[^"]*" /%\} reported a problem: \{% name text=".*" /%\}$'
  AND NOT EXISTS (
      SELECT 1 FROM "ProblemReport" pr WHERE pr."noteId" = n."id"
  );
