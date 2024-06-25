-- It is used to insert team members for all organization owners who do not have a team member record.
-- To test if the migration works, you can run the same query without the first line (INSERT INTO "TeamMember" ...) and check the results.	
INSERT INTO "TeamMember" (id, name, "organizationId", "userId", "createdAt", "updatedAt")
SELECT
  'c' || md5(random()::text || clock_timestamp()::text)::uuid,  -- Simulates cuid generation
  COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", ''),  -- Combines first name and last name, replacing NULL with empty string
  o.id,  -- Organization ID
  o."userId",  -- User ID
  NOW(),  -- Current timestamp for createdAt
  NOW()  -- Current timestamp for updatedAt
FROM
  "Organization" o
  LEFT JOIN "TeamMember" tm ON o.id = tm."organizationId" AND o."userId" = tm."userId"
  JOIN "User" u ON o."userId" = u.id
WHERE
  tm.id IS NULL;
