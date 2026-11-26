-- Copies the reports that exist only as history lines into "ProblemReport",
-- then gives each copied report its activity event.
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

-- Gives every report that has no activity event its event, as the app writes
-- one with each report: same workspace, asset, actor and time, the report
-- named in "meta", and no report text. The hourly report limit counts these
-- events, so a copied report counts exactly like one the app saved.
--
-- The previous migration added the enum value in its own transaction, so it
-- can be used here. Safe to run again: a report that has its event is skipped.
INSERT INTO "ActivityEvent" (
    "id", "organizationId", "occurredAt", "actorUserId", "actorSnapshot",
    "action", "entityType", "entityId", "assetId", "meta"
)
SELECT
    gen_random_uuid()::text,
    pr."organizationId",
    pr."createdAt" AT TIME ZONE 'UTC',
    pr."reporterId",
    CASE
        WHEN u."id" IS NULL THEN NULL
        ELSE jsonb_build_object(
            'firstName', u."firstName",
            'lastName', u."lastName",
            'displayName', u."displayName"
        )
    END,
    'ASSET_PROBLEM_REPORTED',
    'ASSET',
    pr."assetId",
    pr."assetId",
    jsonb_build_object('problemReportId', pr."id")
FROM "ProblemReport" pr
LEFT JOIN "User" u ON u."id" = pr."reporterId"
WHERE NOT EXISTS (
    SELECT 1
    FROM "ActivityEvent" e
    WHERE e."organizationId" = pr."organizationId"
      AND e."action" = 'ASSET_PROBLEM_REPORTED'
      AND e."meta" ->> 'problemReportId' = pr."id"
);
