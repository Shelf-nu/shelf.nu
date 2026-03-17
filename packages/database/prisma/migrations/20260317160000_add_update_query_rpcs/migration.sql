-- Migration: Add RPC functions for querying updates with role-based filtering
-- These support the Supabase migration of update/service.server.ts

-- Get updates for a user filtered by role and publish status
-- Returns updates with their userRead records for the given user
CREATE OR REPLACE FUNCTION get_updates_for_user(
  p_user_id TEXT,
  p_user_role "OrganizationRoles"
)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  content TEXT,
  url TEXT,
  "imageUrl" TEXT,
  "publishDate" TIMESTAMPTZ,
  status "UpdateStatus",
  "targetRoles" "OrganizationRoles"[],
  "clickCount" INT,
  "viewCount" INT,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "userReadId" TEXT,
  "userReadAt" TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.title,
    u.content,
    u.url,
    u."imageUrl",
    u."publishDate",
    u.status,
    u."targetRoles",
    u."clickCount",
    u."viewCount",
    u."createdById",
    u."createdAt",
    u."updatedAt",
    ur.id AS "userReadId",
    ur."readAt" AS "userReadAt"
  FROM "Update" u
  LEFT JOIN "UserUpdateRead" ur
    ON ur."updateId" = u.id AND ur."userId" = p_user_id
  WHERE u.status = 'PUBLISHED'
    AND u."publishDate" <= NOW()
    AND (
      u."targetRoles" = '{}' OR
      p_user_role = ANY(u."targetRoles")
    )
  ORDER BY u."publishDate" DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Count unread updates for a user
CREATE OR REPLACE FUNCTION get_unread_update_count(
  p_user_id TEXT,
  p_user_role "OrganizationRoles"
)
RETURNS INT AS $$
DECLARE
  result INT;
BEGIN
  SELECT COUNT(*)::INT INTO result
  FROM "Update" u
  WHERE u.status = 'PUBLISHED'
    AND u."publishDate" <= NOW()
    AND (
      u."targetRoles" = '{}' OR
      p_user_role = ANY(u."targetRoles")
    )
    AND NOT EXISTS (
      SELECT 1 FROM "UserUpdateRead" ur
      WHERE ur."updateId" = u.id AND ur."userId" = p_user_id
    );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get unread update IDs for a user (used by markAllUpdatesAsRead)
CREATE OR REPLACE FUNCTION get_unread_update_ids(
  p_user_id TEXT,
  p_user_role "OrganizationRoles"
)
RETURNS TEXT[] AS $$
DECLARE
  result TEXT[];
BEGIN
  SELECT ARRAY_AGG(u.id) INTO result
  FROM "Update" u
  WHERE u.status = 'PUBLISHED'
    AND u."publishDate" <= NOW()
    AND (
      u."targetRoles" = '{}' OR
      p_user_role = ANY(u."targetRoles")
    )
    AND NOT EXISTS (
      SELECT 1 FROM "UserUpdateRead" ur
      WHERE ur."updateId" = u.id AND ur."userId" = p_user_id
    );

  RETURN COALESCE(result, '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
