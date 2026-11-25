-- Copies the reports that exist only as history lines into "ProblemReport".
--
-- Its own migration, so this read of "Note" does not run while the previous
-- one still holds the locks its foreign keys take on "Asset", "Organization",
-- "User" and "Note".
--
-- A report line is an UPDATE note of exactly this shape, written by
-- `buildProblemReportNote`:
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
