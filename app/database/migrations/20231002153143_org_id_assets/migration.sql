-- add organizationId to assets
UPDATE public."Asset" AS a
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = a."userId" AND o.type = 'PERSONAL'
)