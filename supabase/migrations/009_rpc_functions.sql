-- =============================================================================
-- 009_rpc_functions.sql
-- Postgres RPC functions for operations requiring transactional atomicity.
-- These replace Prisma $transaction() calls with proper DB-level transactions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. booking_checkout
--    Checks out a booking: marks assets as CHECKED_OUT and updates booking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_checkout(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_data jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
BEGIN
  -- Update asset statuses to CHECKED_OUT
  UPDATE "Asset"
  SET status = 'CHECKED_OUT'
  WHERE id = ANY(p_asset_ids);

  -- Update the booking with provided data
  UPDATE "Booking"
  SET
    status = COALESCE(p_data->>'status', status),
    "from" = COALESCE((p_data->>'from')::timestamptz, "from"),
    "to" = COALESCE((p_data->>'to')::timestamptz, "to"),
    "activeSchedulerReference" = COALESCE(p_data->>'activeSchedulerReference', "activeSchedulerReference"),
    "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 2. booking_checkin
--    Checks in a booking: marks assets as AVAILABLE, updates booking status,
--    deletes custodies, updates kits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_checkin(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_kit_ids uuid[],
  p_status text,
  p_active_scheduler_reference text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
BEGIN
  -- Mark assets as AVAILABLE
  UPDATE "Asset"
  SET status = 'AVAILABLE'
  WHERE id = ANY(p_asset_ids);

  -- Delete asset custodies
  DELETE FROM "Custody"
  WHERE "assetId" = ANY(p_asset_ids);

  -- Update kit statuses and delete kit custodies if applicable
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_kit_ids);
  END IF;

  -- Update booking status
  UPDATE "Booking"
  SET
    status = p_status::booking_status,
    "activeSchedulerReference" = p_active_scheduler_reference,
    "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 3. booking_partial_checkin
--    Partial check-in: mark specific assets as AVAILABLE, create/update
--    partial checkin records, update kit statuses if all kit assets are in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_partial_checkin(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_complete_kit_ids uuid[],
  p_checked_in_by uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
  v_asset_id uuid;
BEGIN
  -- Mark checked-in assets as AVAILABLE
  UPDATE "Asset"
  SET status = 'AVAILABLE'
  WHERE id = ANY(p_asset_ids);

  -- Delete custodies for checked-in assets
  DELETE FROM "Custody"
  WHERE "assetId" = ANY(p_asset_ids);

  -- Upsert partial checkin records
  FOREACH v_asset_id IN ARRAY p_asset_ids
  LOOP
    INSERT INTO "PartialBookingCheckin" ("bookingId", "assetId", "checkedInAt", "checkedInById")
    VALUES (p_booking_id, v_asset_id, now(), p_checked_in_by)
    ON CONFLICT ("bookingId", "assetId") DO UPDATE
    SET "checkedInAt" = now(), "checkedInById" = p_checked_in_by;
  END LOOP;

  -- Update complete kit statuses
  IF array_length(p_complete_kit_ids, 1) > 0 THEN
    UPDATE "Kit"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_complete_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_complete_kit_ids);
  END IF;

  SELECT to_jsonb("Booking".*) INTO v_booking
  FROM "Booking"
  WHERE id = p_booking_id;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. booking_cancel
--    Cancels a booking: makes assets available, removes custodies,
--    updates kit statuses, marks booking as CANCELLED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_cancel(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_kit_ids uuid[],
  p_was_ongoing boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
BEGIN
  -- If booking was ongoing/overdue, make assets available
  IF p_was_ongoing AND array_length(p_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_asset_ids);

    -- Delete custodies
    DELETE FROM "Custody"
    WHERE "assetId" = ANY(p_asset_ids);
  END IF;

  -- Update kit statuses
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_kit_ids);
  END IF;

  -- Cancel the booking
  UPDATE "Booking"
  SET
    status = 'CANCELLED',
    "activeSchedulerReference" = NULL,
    "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 5. bulk_delete_bookings
--    Deletes multiple bookings and makes their ongoing assets available.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_delete_bookings(
  p_booking_ids uuid[],
  p_ongoing_asset_ids uuid[],
  p_kit_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Make ongoing assets available
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_ongoing_asset_ids);

    DELETE FROM "Custody"
    WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;

  -- Reset kit statuses
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'
    WHERE id = ANY(p_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_kit_ids);
  END IF;

  -- Delete bookings
  DELETE FROM "Booking"
  WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 6. bulk_archive_bookings
--    Archives multiple bookings: updates status, makes ongoing assets available.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_archive_bookings(
  p_booking_ids uuid[],
  p_ongoing_asset_ids uuid[],
  p_kit_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Make ongoing assets available
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_ongoing_asset_ids);

    DELETE FROM "Custody"
    WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;

  -- Reset kit statuses
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'
    WHERE id = ANY(p_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_kit_ids);
  END IF;

  -- Archive bookings
  UPDATE "Booking"
  SET status = 'ARCHIVED', "updatedAt" = now()
  WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 7. bulk_cancel_bookings
--    Cancels multiple bookings: updates status, makes ongoing assets available.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_cancel_bookings(
  p_booking_ids uuid[],
  p_ongoing_asset_ids uuid[],
  p_kit_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Make ongoing assets available
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_ongoing_asset_ids);

    DELETE FROM "Custody"
    WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;

  -- Reset kit statuses
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'
    WHERE id = ANY(p_kit_ids);

    DELETE FROM "KitCustody"
    WHERE "kitId" = ANY(p_kit_ids);
  END IF;

  -- Cancel bookings
  UPDATE "Booking"
  SET status = 'CANCELLED', "activeSchedulerReference" = NULL, "updatedAt" = now()
  WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 8. bulk_assign_custody
--    Assigns custody of multiple assets to a team member.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_assign_custody(
  p_asset_ids uuid[],
  p_team_member_id uuid
)
RETURNS void AS $$
BEGIN
  -- Create custody records
  INSERT INTO "Custody" ("assetId", "teamMemberId")
  SELECT unnest(p_asset_ids), p_team_member_id
  ON CONFLICT ("assetId") DO NOTHING;

  -- Update asset statuses
  UPDATE "Asset"
  SET status = 'IN_CUSTODY'
  WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 9. bulk_release_custody
--    Releases custody of multiple assets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_release_custody(
  p_asset_ids uuid[],
  p_custody_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Delete custody records
  DELETE FROM "Custody"
  WHERE id = ANY(p_custody_ids);

  -- Update asset statuses to AVAILABLE
  UPDATE "Asset"
  SET status = 'AVAILABLE'
  WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 10. bulk_update_location
--     Updates location for multiple assets atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_update_location(
  p_asset_ids uuid[],
  p_location_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE "Asset"
  SET "locationId" = p_location_id
  WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 11. transfer_org_ownership
--     Transfers organization ownership from one user to another.
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
  SET roles = array_remove(roles, 'OWNER') || ARRAY['ADMIN']::text[]
  WHERE "userId" = p_current_owner_id AND "organizationId" = p_org_id;

  -- Update new owner's role to OWNER
  UPDATE "UserOrganization"
  SET roles = array_remove(roles, 'ADMIN') || ARRAY['OWNER']::text[]
  WHERE "userId" = p_new_owner_id AND "organizationId" = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 12. add_assets_to_booking
--     Adds assets to a booking via the join table, and optionally
--     marks them as CHECKED_OUT if booking is ongoing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_assets_to_booking(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_mark_checked_out boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
BEGIN
  -- Verify booking exists
  IF NOT EXISTS (SELECT 1 FROM "Booking" WHERE id = p_booking_id) THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'PGRST116';
  END IF;

  -- Insert into join table
  INSERT INTO "_AssetToBooking" ("A", "B")
  SELECT unnest(p_asset_ids), p_booking_id
  ON CONFLICT DO NOTHING;

  -- Mark as checked out if needed
  IF p_mark_checked_out THEN
    UPDATE "Asset"
    SET status = 'CHECKED_OUT'
    WHERE id = ANY(p_asset_ids);
  END IF;

  SELECT to_jsonb("Booking".*) INTO v_booking
  FROM "Booking"
  WHERE id = p_booking_id;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 13. remove_assets_from_booking
--     Removes assets from a booking and optionally makes them available.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_assets_from_booking(
  p_booking_id uuid,
  p_asset_ids uuid[],
  p_make_available boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_booking jsonb;
BEGIN
  -- Remove from join table
  DELETE FROM "_AssetToBooking"
  WHERE "A" = ANY(p_asset_ids) AND "B" = p_booking_id;

  -- Make available if needed
  IF p_make_available THEN
    UPDATE "Asset"
    SET status = 'AVAILABLE'
    WHERE id = ANY(p_asset_ids);
  END IF;

  SELECT to_jsonb("Booking".*) INTO v_booking
  FROM "Booking"
  WHERE id = p_booking_id;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 14. delete_custom_field_cascade
--     Soft-deletes a custom field and removes it from asset index settings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_custom_field_cascade(
  p_custom_field_id uuid,
  p_organization_id uuid,
  p_custom_field_name text
)
RETURNS jsonb AS $$
DECLARE
  v_field jsonb;
BEGIN
  -- Verify the field exists and belongs to the org
  SELECT to_jsonb(cf.*) INTO v_field
  FROM "CustomField" cf
  WHERE cf.id = p_custom_field_id
    AND cf."organizationId" = p_organization_id
    AND cf."deletedAt" IS NULL;

  IF v_field IS NULL THEN
    RAISE EXCEPTION 'Custom field not found' USING ERRCODE = 'PGRST116';
  END IF;

  -- Soft delete the custom field
  UPDATE "CustomField"
  SET "deletedAt" = now(), "updatedAt" = now()
  WHERE id = p_custom_field_id;

  -- Remove from asset index settings columns
  UPDATE "AssetIndexSettings"
  SET columns = columns - p_custom_field_name,
      "updatedAt" = now()
  WHERE "organizationId" = p_organization_id
    AND columns ? p_custom_field_name;

  RETURN v_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 15. get_location_descendants
--     Recursive CTE to get all descendant locations of a parent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_location_descendants(p_parent_id uuid)
RETURNS TABLE(id uuid, name text, depth int) AS $$
  WITH RECURSIVE location_tree AS (
    SELECT l.id, l.name, 1 AS depth
    FROM "Location" l
    WHERE l."parentLocationId" = p_parent_id

    UNION ALL

    SELECT l.id, l.name, lt.depth + 1
    FROM "Location" l
    INNER JOIN location_tree lt ON l."parentLocationId" = lt.id
  )
  SELECT * FROM location_tree;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- 16. bulk_kit_assign_custody
--     Assigns custody of multiple kits to a custodian.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_kit_assign_custody(
  p_kit_ids uuid[],
  p_custodian_id uuid
)
RETURNS void AS $$
BEGIN
  -- Create kit custody records
  INSERT INTO "KitCustody" ("custodianId", "kitId")
  SELECT p_custodian_id, unnest(p_kit_ids)
  ON CONFLICT DO NOTHING;

  -- Update kit statuses
  UPDATE "Kit"
  SET status = 'IN_CUSTODY'
  WHERE id = ANY(p_kit_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 17. bulk_kit_release_custody
--     Releases custody of multiple kits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_kit_release_custody(
  p_kit_ids uuid[]
)
RETURNS void AS $$
BEGIN
  -- Delete kit custody records
  DELETE FROM "KitCustody"
  WHERE "kitId" = ANY(p_kit_ids);

  -- Update kit statuses to AVAILABLE
  UPDATE "Kit"
  SET status = 'AVAILABLE'
  WHERE id = ANY(p_kit_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 18. remove_custom_field_from_index_settings
--     Removes a custom field column from asset index settings JSON.
--     Replaces the $executeRaw that manipulated JSONB columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_custom_field_from_index_settings(
  p_custom_field_name text,
  p_organization_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE "AssetIndexSettings"
  SET columns = columns - p_custom_field_name,
      "updatedAt" = now()
  WHERE "organizationId" = p_organization_id
    AND columns ? p_custom_field_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
