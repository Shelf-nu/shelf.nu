-- =============================================================================
-- 006_triggers.sql
-- Auto-update updated_at trigger + activity_log auto-capture triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Apply updated_at trigger to all tables with an updated_at column
--    (Prisma handled this at ORM level via @updatedAt; now we use triggers)
-- ---------------------------------------------------------------------------

-- Shelf base tables
CREATE TRIGGER trg_image_updated_at BEFORE UPDATE ON "Image"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_updated_at BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_contact_updated_at BEFORE UPDATE ON "UserContact"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_updated_at BEFORE UPDATE ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_filter_preset_updated_at BEFORE UPDATE ON "AssetFilterPreset"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_index_settings_updated_at BEFORE UPDATE ON "AssetIndexSettings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_category_updated_at BEFORE UPDATE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tag_updated_at BEFORE UPDATE ON "Tag"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_note_updated_at BEFORE UPDATE ON "Note"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_booking_note_updated_at BEFORE UPDATE ON "BookingNote"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_location_note_updated_at BEFORE UPDATE ON "LocationNote"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_qr_updated_at BEFORE UPDATE ON "Qr"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_barcode_updated_at BEFORE UPDATE ON "Barcode"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_print_batch_updated_at BEFORE UPDATE ON "PrintBatch"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_report_found_updated_at BEFORE UPDATE ON "ReportFound"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_scan_updated_at BEFORE UPDATE ON "Scan"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_location_updated_at BEFORE UPDATE ON "Location"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_role_updated_at BEFORE UPDATE ON "Role"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_team_member_updated_at BEFORE UPDATE ON "TeamMember"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_custody_updated_at BEFORE UPDATE ON "Custody"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_organization_updated_at BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_organization_updated_at BEFORE UPDATE ON "UserOrganization"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_custom_field_updated_at BEFORE UPDATE ON "CustomField"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_custom_field_value_updated_at BEFORE UPDATE ON "AssetCustomFieldValue"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invite_updated_at BEFORE UPDATE ON "Invite"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_booking_updated_at BEFORE UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_booking_settings_updated_at BEFORE UPDATE ON "BookingSettings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_partial_booking_checkin_updated_at BEFORE UPDATE ON "PartialBookingCheckin"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_kit_updated_at BEFORE UPDATE ON "Kit"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_kit_custody_updated_at BEFORE UPDATE ON "KitCustody"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_reminder_updated_at BEFORE UPDATE ON "AssetReminder"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_working_hours_updated_at BEFORE UPDATE ON "WorkingHours"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_working_hours_override_updated_at BEFORE UPDATE ON "WorkingHoursOverride"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_update_updated_at BEFORE UPDATE ON "Update"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_session_updated_at BEFORE UPDATE ON "AuditSession"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_assignment_updated_at BEFORE UPDATE ON "AuditAssignment"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_asset_updated_at BEFORE UPDATE ON "AuditAsset"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_note_updated_at BEFORE UPDATE ON "AuditNote"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_image_updated_at BEFORE UPDATE ON "AuditImage"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- New MSP tables
CREATE TRIGGER trg_person_updated_at BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vendor_updated_at BEFORE UPDATE ON vendor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_software_application_updated_at BEFORE UPDATE ON software_application
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_license_assignment_updated_at BEFORE UPDATE ON license_assignment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_lease_updated_at BEFORE UPDATE ON lease
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_sync_source_updated_at BEFORE UPDATE ON asset_sync_source
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_asset_status_config_updated_at BEFORE UPDATE ON asset_status_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Note: activity_log has no updated_at (append-only table)

-- ---------------------------------------------------------------------------
-- 3. Activity log auto-capture trigger function
--    Records INSERT/UPDATE/DELETE on key tables into activity_log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id uuid;
  v_action activity_action;
  v_old_row jsonb;
  v_new_row jsonb;
  v_key text;
  v_old_val text;
  v_new_val text;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
  END IF;

  -- Extract organization_id (try both naming conventions)
  IF TG_OP = 'DELETE' THEN
    v_org_id := COALESCE(
      (row_to_json(OLD)::jsonb ->> 'organizationId')::uuid,
      (row_to_json(OLD)::jsonb ->> 'organization_id')::uuid
    );
  ELSE
    v_org_id := COALESCE(
      (row_to_json(NEW)::jsonb ->> 'organizationId')::uuid,
      (row_to_json(NEW)::jsonb ->> 'organization_id')::uuid
    );
  END IF;

  -- For INSERT: log one row with no field detail
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (
      organization_id, entity_type, entity_id, action,
      changed_by_user_id, created_at
    ) VALUES (
      v_org_id,
      TG_TABLE_NAME,
      (row_to_json(NEW)::jsonb ->> 'id')::uuid,
      v_action,
      NULLIF(auth.user_id(), '')::uuid,
      now()
    );
    RETURN NEW;
  END IF;

  -- For DELETE: log one row with no field detail
  IF TG_OP = 'DELETE' THEN
    INSERT INTO activity_log (
      organization_id, entity_type, entity_id, action,
      changed_by_user_id, created_at
    ) VALUES (
      v_org_id,
      TG_TABLE_NAME,
      (row_to_json(OLD)::jsonb ->> 'id')::uuid,
      v_action,
      NULLIF(auth.user_id(), '')::uuid,
      now()
    );
    RETURN OLD;
  END IF;

  -- For UPDATE: log each changed field individually
  v_old_row := row_to_json(OLD)::jsonb;
  v_new_row := row_to_json(NEW)::jsonb;

  FOR v_key IN SELECT jsonb_object_keys(v_new_row)
  LOOP
    -- Skip metadata columns
    IF v_key IN ('updatedAt', 'updated_at', 'createdAt', 'created_at') THEN
      CONTINUE;
    END IF;

    v_old_val := v_old_row ->> v_key;
    v_new_val := v_new_row ->> v_key;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO activity_log (
        organization_id, entity_type, entity_id, action,
        field_name, old_value, new_value,
        changed_by_user_id, created_at
      ) VALUES (
        v_org_id,
        TG_TABLE_NAME,
        (v_new_row ->> 'id')::uuid,
        v_action,
        v_key,
        v_old_val,
        v_new_val,
        NULLIF(auth.user_id(), '')::uuid,
        now()
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. Apply activity_log triggers to key tables
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_asset_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_person_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON person
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_organization_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_custody_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "Custody"
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_booking_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_kit_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "Kit"
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_team_member_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON "TeamMember"
  FOR EACH ROW EXECUTE FUNCTION log_activity();
