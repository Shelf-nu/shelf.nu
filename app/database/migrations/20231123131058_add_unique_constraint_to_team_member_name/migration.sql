CREATE UNIQUE INDEX "TeamMember_name_organizationId_key" 
ON "TeamMember"(LOWER("name"), "organizationId") 
WHERE "deletedAt" IS NULL;