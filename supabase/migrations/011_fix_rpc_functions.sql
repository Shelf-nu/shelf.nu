-- =============================================================================
-- 011_fix_rpc_functions.sql
-- Fix RPC function issues identified in migration review:
--   1. Fix transfer_org_ownership enum array casting
--   2. Add kit transaction RPC functions (missing from 009)
--   3. Add explicit enum casts for asset status updates
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix transfer_org_ownership: use organization_roles enum, not text
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION transfer_org_ownership(
  p_org_id uuid,
  p_current_owner_id uuid,
  p_new_owner_id uuid
)
RETURNS void AS $$
BEGIN
  -- Update organization owner
  UPDATE "Organization"
  SET "userId" = p_new_owner_id, "updatedAt" = now()
  WHERE id = p_org_id;

  -- Update current owner's role to ADMIN
  UPDATE "UserOrganization"
  SET roles = array_remove(roles, 'OWNER'::organization_roles)
              || ARRAY['ADMIN']::organization_roles[]
  WHERE "userId" = p_current_owner_id AND "organizationId" = p_org_id;

  -- Update new owner's role to OWNER
  UPDATE "UserOrganization"
  SET roles = array_remove(roles, 'ADMIN'::organization_roles)
              || ARRAY['OWNER']::organization_roles[]
  WHERE "userId" = p_new_owner_id AND "organizationId" = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 2. Kit transaction RPC functions
--    These replace the 6 db.$transaction() calls in kit/service.server.ts
-- ---------------------------------------------------------------------------

-- 2.1 kit_assign_custody
--     Assigns custody of a kit and its assets to a team member.
CREATE OR REPLACE FUNCTION kit_assign_custody(
  p_kit_id uuid,
  p_custodian_id uuid,
  p_asset_ids uuid[]
)
RETURNS jsonb AS $$
DECLARE
  v_kit jsonb;
BEGIN
  -- Create kit custody
  INSERT INTO "KitCustody" ("custodianId", "kitId")
  VALUES (p_custodian_id, p_kit_id)
  ON CONFLICT DO NOTHING;

  -- Update kit status
  UPDATE "Kit"
  SET status = 'IN_CUSTODY'::kit_status
  WHERE id = p_kit_id;

  -- Create asset custodies
  INSERT INTO "Custody" ("assetId", "teamMemberId")
  SELECT unnest(p_asset_ids), p_custodian_id
  ON CONFLICT ("assetId") DO NOTHING;

  -- Update asset statuses
  UPDATE "Asset"
  SET status = 'IN_CUSTODY'::asset_status
  WHERE id = ANY(p_asset_ids);

  SELECT to_jsonb("Kit".*) INTO v_kit
  FROM "Kit" WHERE id = p_kit_id;

  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.2 kit_release_custody
--     Releases custody of a kit and its assets.
CREATE OR REPLACE FUNCTION kit_release_custody(
  p_kit_id uuid,
  p_asset_ids uuid[]
)
RETURNS jsonb AS $$
DECLARE
  v_kit jsonb;
BEGIN
  -- Delete kit custody
  DELETE FROM "KitCustody"
  WHERE "kitId" = p_kit_id;

  -- Update kit status
  UPDATE "Kit"
  SET status = 'AVAILABLE'::kit_status
  WHERE id = p_kit_id;

  -- Delete asset custodies
  DELETE FROM "Custody"
  WHERE "assetId" = ANY(p_asset_ids);

  -- Update asset statuses
  UPDATE "Asset"
  SET status = 'AVAILABLE'::asset_status
  WHERE id = ANY(p_asset_ids);

  SELECT to_jsonb("Kit".*) INTO v_kit
  FROM "Kit" WHERE id = p_kit_id;

  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.3 kit_update_with_assets
--     Updates a kit's metadata and manages its asset assignments atomically.
CREATE OR REPLACE FUNCTION kit_update_with_assets(
  p_kit_id uuid,
  p_data jsonb,
  p_add_asset_ids uuid[],
  p_remove_asset_ids uuid[]
)
RETURNS jsonb AS $$
DECLARE
  v_kit jsonb;
BEGIN
  -- Update kit fields
  UPDATE "Kit"
  SET
    name = COALESCE(p_data->>'name', name),
    description = COALESCE(p_data->>'description', description),
    status = COALESCE((p_data->>'status')::kit_status, status),
    "updatedAt" = now()
  WHERE id = p_kit_id;

  -- Add assets to kit
  IF array_length(p_add_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET "kitId" = p_kit_id
    WHERE id = ANY(p_add_asset_ids);
  END IF;

  -- Remove assets from kit
  IF array_length(p_remove_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET "kitId" = NULL
    WHERE id = ANY(p_remove_asset_ids);
  END IF;

  SELECT to_jsonb("Kit".*) INTO v_kit
  FROM "Kit" WHERE id = p_kit_id;

  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.4 kit_delete_with_cleanup
--     Deletes a kit, releasing custody and making assets available.
CREATE OR REPLACE FUNCTION kit_delete_with_cleanup(
  p_kit_id uuid,
  p_asset_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Release kit custody
  DELETE FROM "KitCustody" WHERE "kitId" = p_kit_id;

  -- Release asset custodies for kit assets
  DELETE FROM "Custody"
  WHERE "assetId" = ANY(p_asset_ids);

  -- Make assets available and remove kit reference
  UPDATE "Asset"
  SET status = 'AVAILABLE'::asset_status, "kitId" = NULL
  WHERE id = ANY(p_asset_ids);

  -- Delete the kit
  DELETE FROM "Kit" WHERE id = p_kit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
