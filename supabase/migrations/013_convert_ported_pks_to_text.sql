-- =============================================================================
-- 013_convert_ported_pks_to_text.sql
-- Convert ported table PKs from uuid to text for backward compatibility.
--
-- Rationale (review item #7):
--   The migration plan recommends "use uuid type for new tables, keep text
--   for ported tables to avoid FK cascade headaches." Shelf.nu production
--   data uses 25-character CUID strings that cannot be inserted into uuid
--   columns. The application still generates CUIDs via id(LEGACY_CUID_LENGTH).
--
--   New MSP tables (from 004) correctly use native uuid and are NOT changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: programmatically drop all FK constraints, convert columns, recreate
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  -- Tables whose PKs should remain uuid (new MSP tables from 004)
  msp_tables text[] := ARRAY[
    'person', 'vendor', 'software_application',
    'license_assignment', 'lease', 'asset_sync_source',
    'activity_log', 'asset_status_config'
  ];
  rec RECORD;
  fk_rec RECORD;
  fk_defs text[];
BEGIN
  -- =========================================================================
  -- Phase 1: Save and drop ALL foreign key constraints
  -- =========================================================================
  fk_defs := ARRAY[]::text[];

  FOR fk_rec IN
    SELECT
      tc.constraint_name,
      tc.table_schema,
      tc.table_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  LOOP
    -- Save the FK definition for later recreation
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      fk_rec.table_schema, fk_rec.table_name, fk_rec.constraint_name
    );
  END LOOP;

  -- =========================================================================
  -- Phase 2: Convert PK columns from uuid to text on ported tables
  -- =========================================================================
  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.table_constraints tc
      ON tc.table_name = c.table_name
      AND tc.table_schema = c.table_schema
      AND tc.constraint_type = 'PRIMARY KEY'
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.column_name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.data_type = 'uuid'
      AND c.table_name != ALL(msp_tables)
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE text USING %I::text',
      rec.table_name, rec.column_name, rec.column_name
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT gen_random_uuid()::text',
      rec.table_name, rec.column_name
    );
    RAISE NOTICE 'Converted PK %.% from uuid to text', rec.table_name, rec.column_name;
  END LOOP;

  -- =========================================================================
  -- Phase 3: Convert FK reference columns from uuid to text
  --          (columns referencing ported table PKs)
  -- =========================================================================
  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'uuid'
      -- Exclude PK columns (already handled) and MSP table columns
      AND c.table_name != ALL(msp_tables)
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = c.table_name
          AND tc.table_schema = c.table_schema
          AND tc.constraint_type = 'PRIMARY KEY'
          AND kcu.column_name = c.column_name
      )
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE text USING %I::text',
      rec.table_name, rec.column_name, rec.column_name
    );
    RAISE NOTICE 'Converted FK column %.% from uuid to text',
      rec.table_name, rec.column_name;
  END LOOP;

  -- Also convert uuid FK columns on MSP tables that reference ported tables
  -- (e.g., person.organization_id references Organization.id which is now text)
  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'uuid'
      AND c.table_name = ANY(msp_tables)
      AND c.column_name IN (
        'organization_id',  -- references Organization.id (ported)
        'asset_id'          -- references Asset.id (ported)
      )
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE text USING %I::text',
      rec.table_name, rec.column_name, rec.column_name
    );
    RAISE NOTICE 'Converted MSP FK column %.% from uuid to text',
      rec.table_name, rec.column_name;
  END LOOP;
END $$;

-- =========================================================================
-- Phase 4: Recreate all FK constraints
-- (Replaying the constraint definitions from 001, 003, 004 with text types)
-- =========================================================================

-- Note: These are the exact same constraints as 001/003/004 — they work with
-- text columns because both sides are now text. PostgreSQL doesn't care about
-- the underlying type as long as both sides match.

-- From 001 Section 3: Foreign key constraints
-- (Omitting Tier/TierLimit/SsoDetails/CustomTierLimit/_RoleToUser — dropped in 002)

ALTER TABLE "User"
  ADD CONSTRAINT "User_lastSelectedOrganizationId_fkey"
    FOREIGN KEY ("lastSelectedOrganizationId") REFERENCES "Organization"(id)
    ON DELETE SET NULL;

ALTER TABLE "UserContact"
  ADD CONSTRAINT "UserContact_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Organization_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"(id);

ALTER TABLE "Image"
  ADD CONSTRAINT "Image_ownerOrgId_fkey"
    FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Image_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE;

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "Image"(id),
  ADD CONSTRAINT "Location_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Location_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Location_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Location"(id)
    ON DELETE SET NULL;

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Category_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Kit"
  ADD CONSTRAINT "Kit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Kit_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id),
  ADD CONSTRAINT "Kit_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"(id),
  ADD CONSTRAINT "Kit_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id);

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Asset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Asset_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"(id),
  ADD CONSTRAINT "Asset_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id),
  ADD CONSTRAINT "Asset_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id);

ALTER TABLE "AssetFilterPreset"
  ADD CONSTRAINT "AssetFilterPreset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "AssetFilterPreset_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"(id)
    ON DELETE CASCADE;

ALTER TABLE "AssetIndexSettings"
  ADD CONSTRAINT "AssetIndexSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetIndexSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Tag_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Note"
  ADD CONSTRAINT "Note_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Note_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingNote"
  ADD CONSTRAINT "BookingNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BookingNote_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationNote"
  ADD CONSTRAINT "LocationNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LocationNote_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Qr"
  ADD CONSTRAINT "Qr_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Qr_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Qr_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Qr_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON UPDATE CASCADE,
  ADD CONSTRAINT "Qr_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PrintBatch"(id)
    ON DELETE SET NULL;

ALTER TABLE "Barcode"
  ADD CONSTRAINT "Barcode_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Barcode_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Barcode_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportFound"
  ADD CONSTRAINT "ReportFound_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportFound_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Scan"
  ADD CONSTRAINT "Scan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "Scan_qrId_fkey"
    FOREIGN KEY ("qrId") REFERENCES "Qr"(id)
    ON DELETE SET NULL;

ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Custody"
  ADD CONSTRAINT "Custody_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"(id),
  ADD CONSTRAINT "Custody_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserOrganization"
  ADD CONSTRAINT "UserOrganization_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserOrganization_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomField"
  ADD CONSTRAINT "CustomField_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomField_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON UPDATE CASCADE;

ALTER TABLE "AssetCustomFieldValue"
  ADD CONSTRAINT "AssetCustomFieldValue_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_inviterId_fkey"
    FOREIGN KEY ("inviterId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_inviteeUserId_fkey"
    FOREIGN KEY ("inviteeUserId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Invite_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"(id);

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_custodianUserId_fkey"
    FOREIGN KEY ("custodianUserId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_custodianTeamMemberId_fkey"
    FOREIGN KEY ("custodianTeamMemberId") REFERENCES "TeamMember"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Booking_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingSettings"
  ADD CONSTRAINT "BookingSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartialBookingCheckin"
  ADD CONSTRAINT "PartialBookingCheckin_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "PartialBookingCheckin_checkedInById_fkey"
    FOREIGN KEY ("checkedInById") REFERENCES "User"(id);

ALTER TABLE "KitCustody"
  ADD CONSTRAINT "KitCustody_custodianId_fkey"
    FOREIGN KEY ("custodianId") REFERENCES "TeamMember"(id),
  ADD CONSTRAINT "KitCustody_kitId_fkey"
    FOREIGN KEY ("kitId") REFERENCES "Kit"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssetReminder"
  ADD CONSTRAINT "AssetReminder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id),
  ADD CONSTRAINT "AssetReminder_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "AssetReminder_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id);

ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkingHoursOverride"
  ADD CONSTRAINT "WorkingHoursOverride_workingHoursId_fkey"
    FOREIGN KEY ("workingHoursId") REFERENCES "WorkingHours"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Update"
  ADD CONSTRAINT "Update_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserUpdateRead"
  ADD CONSTRAINT "UserUpdateRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserUpdateRead_updateId_fkey"
    FOREIGN KEY ("updateId") REFERENCES "Update"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditSession"
  ADD CONSTRAINT "AuditSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id),
  ADD CONSTRAINT "AuditSession_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditAssignment"
  ADD CONSTRAINT "AuditAssignment_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAsset_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditAsset_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditScan"
  ADD CONSTRAINT "AuditScan_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditScan_scannedById_fkey"
    FOREIGN KEY ("scannedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditNote"
  ADD CONSTRAINT "AuditNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditNote_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditNote_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditImage"
  ADD CONSTRAINT "AuditImage_auditSessionId_fkey"
    FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_auditAssetId_fkey"
    FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditImage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleChangeLog"
  ADD CONSTRAINT "RoleChangeLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id),
  ADD CONSTRAINT "RoleChangeLog_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"(id),
  ADD CONSTRAINT "RoleChangeLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"(id);

-- Join tables
ALTER TABLE "_AssetToTag"
  ADD CONSTRAINT "_AssetToTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Asset"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetToTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_AssetToBooking"
  ADD CONSTRAINT "_AssetToBooking_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Asset"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetToBooking_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Booking"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_CategoryToCustomField"
  ADD CONSTRAINT "_CategoryToCustomField_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Category"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_CategoryToCustomField_B_fkey"
    FOREIGN KEY ("B") REFERENCES "CustomField"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_TagToBooking"
  ADD CONSTRAINT "_TagToBooking_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Booking"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_TagToBooking_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_AssetReminderToTeamMember"
  ADD CONSTRAINT "_AssetReminderToTeamMember_A_fkey"
    FOREIGN KEY ("A") REFERENCES "AssetReminder"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_AssetReminderToTeamMember_B_fkey"
    FOREIGN KEY ("B") REFERENCES "TeamMember"(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- MSP table FKs that reference ported tables (organization_id, asset_id → text)
ALTER TABLE person
  ADD CONSTRAINT "person_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE;

ALTER TABLE vendor
  ADD CONSTRAINT "vendor_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE;

ALTER TABLE software_application
  ADD CONSTRAINT "software_application_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE;

ALTER TABLE license_assignment
  ADD CONSTRAINT "license_assignment_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE,
  ADD CONSTRAINT "license_assignment_software_application_id_fkey"
    FOREIGN KEY (software_application_id) REFERENCES software_application(id)
    ON DELETE CASCADE;

ALTER TABLE lease
  ADD CONSTRAINT "lease_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "lease_asset_id_fkey"
    FOREIGN KEY (asset_id) REFERENCES "Asset"(id) ON DELETE SET NULL,
  ADD CONSTRAINT "lease_vendor_id_fkey"
    FOREIGN KEY (vendor_id) REFERENCES vendor(id) ON DELETE SET NULL;

ALTER TABLE asset_sync_source
  ADD CONSTRAINT "asset_sync_source_asset_id_fkey"
    FOREIGN KEY (asset_id) REFERENCES "Asset"(id) ON DELETE CASCADE;

ALTER TABLE activity_log
  ADD CONSTRAINT "activity_log_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE;

ALTER TABLE asset_status_config
  ADD CONSTRAINT "asset_status_config_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE;

-- MSP FKs from 003 (person_id on Asset and TeamMember)
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE SET NULL;

ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE SET NULL;

-- =========================================================================
-- Phase 5: Update RPC functions to use text parameters
-- (All ported table IDs are now text, not uuid)
-- =========================================================================

-- Recreate all RPC functions with text parameter types.
-- Only MSP-table-specific params keep uuid.

CREATE OR REPLACE FUNCTION booking_checkout(
  p_booking_id text,
  p_asset_ids text[],
  p_data jsonb
) RETURNS jsonb AS $$
DECLARE v_booking jsonb;
BEGIN
  UPDATE "Asset" SET status = 'CHECKED_OUT'::asset_status
    WHERE id = ANY(p_asset_ids);
  UPDATE "Booking" SET
    status = COALESCE(p_data->>'status', status::text)::booking_status,
    "from" = COALESCE((p_data->>'from')::timestamptz, "from"),
    "to" = COALESCE((p_data->>'to')::timestamptz, "to"),
    "activeSchedulerReference" = COALESCE(
      p_data->>'activeSchedulerReference', "activeSchedulerReference"),
    "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION booking_checkin(
  p_booking_id text, p_asset_ids text[], p_kit_ids text[],
  p_status text, p_active_scheduler_reference text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE v_booking jsonb;
BEGIN
  UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
    WHERE id = ANY(p_asset_ids);
  DELETE FROM "Custody" WHERE "assetId" = ANY(p_asset_ids);
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  END IF;
  UPDATE "Booking" SET
    status = p_status::booking_status,
    "activeSchedulerReference" = p_active_scheduler_reference,
    "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION booking_partial_checkin(
  p_booking_id text, p_asset_ids text[],
  p_complete_kit_ids text[], p_checked_in_by text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE v_booking jsonb; v_asset_id text;
BEGIN
  UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
    WHERE id = ANY(p_asset_ids);
  DELETE FROM "Custody" WHERE "assetId" = ANY(p_asset_ids);
  FOREACH v_asset_id IN ARRAY p_asset_ids LOOP
    INSERT INTO "PartialBookingCheckin"
      ("bookingId", "assetId", "checkedInAt", "checkedInById")
    VALUES (p_booking_id, v_asset_id, now(), p_checked_in_by)
    ON CONFLICT ("bookingId", "assetId") DO UPDATE
    SET "checkedInAt" = now(), "checkedInById" = p_checked_in_by;
  END LOOP;
  IF array_length(p_complete_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_complete_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_complete_kit_ids);
  END IF;
  SELECT to_jsonb("Booking".*) INTO v_booking
    FROM "Booking" WHERE id = p_booking_id;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION booking_cancel(
  p_booking_id text, p_asset_ids text[], p_kit_ids text[],
  p_was_ongoing boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE v_booking jsonb;
BEGIN
  IF p_was_ongoing AND array_length(p_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
      WHERE id = ANY(p_asset_ids);
    DELETE FROM "Custody" WHERE "assetId" = ANY(p_asset_ids);
  END IF;
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  END IF;
  UPDATE "Booking" SET
    status = 'CANCELLED'::booking_status,
    "activeSchedulerReference" = NULL, "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING to_jsonb("Booking".*) INTO v_booking;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_delete_bookings(
  p_booking_ids text[], p_ongoing_asset_ids text[], p_kit_ids text[]
) RETURNS void AS $$
BEGIN
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
      WHERE id = ANY(p_ongoing_asset_ids);
    DELETE FROM "Custody" WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  END IF;
  DELETE FROM "Booking" WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_archive_bookings(
  p_booking_ids text[], p_ongoing_asset_ids text[], p_kit_ids text[]
) RETURNS void AS $$
BEGIN
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
      WHERE id = ANY(p_ongoing_asset_ids);
    DELETE FROM "Custody" WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  END IF;
  UPDATE "Booking" SET status = 'ARCHIVED'::booking_status,
    "updatedAt" = now() WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_cancel_bookings(
  p_booking_ids text[], p_ongoing_asset_ids text[], p_kit_ids text[]
) RETURNS void AS $$
BEGIN
  IF array_length(p_ongoing_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
      WHERE id = ANY(p_ongoing_asset_ids);
    DELETE FROM "Custody" WHERE "assetId" = ANY(p_ongoing_asset_ids);
  END IF;
  IF array_length(p_kit_ids, 1) > 0 THEN
    UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
      WHERE id = ANY(p_kit_ids);
    DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  END IF;
  UPDATE "Booking" SET status = 'CANCELLED'::booking_status,
    "activeSchedulerReference" = NULL, "updatedAt" = now()
  WHERE id = ANY(p_booking_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_assign_custody(
  p_asset_ids text[], p_team_member_id text
) RETURNS void AS $$
BEGIN
  INSERT INTO "Custody" ("assetId", "teamMemberId")
    SELECT unnest(p_asset_ids), p_team_member_id
    ON CONFLICT ("assetId") DO NOTHING;
  UPDATE "Asset" SET status = 'IN_CUSTODY'::asset_status
    WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_release_custody(
  p_asset_ids text[], p_custody_ids text[]
) RETURNS void AS $$
BEGIN
  DELETE FROM "Custody" WHERE id = ANY(p_custody_ids);
  UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
    WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_update_location(
  p_asset_ids text[], p_location_id text
) RETURNS void AS $$
BEGIN
  UPDATE "Asset" SET "locationId" = p_location_id
    WHERE id = ANY(p_asset_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION transfer_org_ownership(
  p_org_id text, p_current_owner_id text, p_new_owner_id text
) RETURNS void AS $$
BEGIN
  UPDATE "Organization" SET "userId" = p_new_owner_id, "updatedAt" = now()
    WHERE id = p_org_id;
  UPDATE "UserOrganization"
    SET roles = array_remove(roles, 'OWNER'::organization_roles)
                || ARRAY['ADMIN']::organization_roles[]
    WHERE "userId" = p_current_owner_id AND "organizationId" = p_org_id;
  UPDATE "UserOrganization"
    SET roles = array_remove(roles, 'ADMIN'::organization_roles)
                || ARRAY['OWNER']::organization_roles[]
    WHERE "userId" = p_new_owner_id AND "organizationId" = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_assets_to_booking(
  p_booking_id text, p_asset_ids text[],
  p_mark_checked_out boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE v_booking jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Booking" WHERE id = p_booking_id) THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'PGRST116';
  END IF;
  INSERT INTO "_AssetToBooking" ("A", "B")
    SELECT unnest(p_asset_ids), p_booking_id ON CONFLICT DO NOTHING;
  IF p_mark_checked_out THEN
    UPDATE "Asset" SET status = 'CHECKED_OUT'::asset_status
      WHERE id = ANY(p_asset_ids);
  END IF;
  SELECT to_jsonb("Booking".*) INTO v_booking
    FROM "Booking" WHERE id = p_booking_id;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_assets_from_booking(
  p_booking_id text, p_asset_ids text[],
  p_make_available boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE v_booking jsonb;
BEGIN
  DELETE FROM "_AssetToBooking"
    WHERE "A" = ANY(p_asset_ids) AND "B" = p_booking_id;
  IF p_make_available THEN
    UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
      WHERE id = ANY(p_asset_ids);
  END IF;
  SELECT to_jsonb("Booking".*) INTO v_booking
    FROM "Booking" WHERE id = p_booking_id;
  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_custom_field_cascade(
  p_custom_field_id text, p_organization_id text, p_custom_field_name text
) RETURNS jsonb AS $$
DECLARE v_field jsonb;
BEGIN
  SELECT to_jsonb(cf.*) INTO v_field FROM "CustomField" cf
    WHERE cf.id = p_custom_field_id
      AND cf."organizationId" = p_organization_id AND cf."deletedAt" IS NULL;
  IF v_field IS NULL THEN
    RAISE EXCEPTION 'Custom field not found' USING ERRCODE = 'PGRST116';
  END IF;
  UPDATE "CustomField" SET "deletedAt" = now(), "updatedAt" = now()
    WHERE id = p_custom_field_id;
  UPDATE "AssetIndexSettings"
    SET columns = columns - p_custom_field_name, "updatedAt" = now()
    WHERE "organizationId" = p_organization_id AND columns ? p_custom_field_name;
  RETURN v_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_location_descendants(p_parent_id text)
RETURNS TABLE(id text, name text, depth int) AS $$
  WITH RECURSIVE location_tree AS (
    SELECT l.id, l.name, 1 AS depth FROM "Location" l
      WHERE l."parentLocationId" = p_parent_id
    UNION ALL
    SELECT l.id, l.name, lt.depth + 1 FROM "Location" l
      INNER JOIN location_tree lt ON l."parentLocationId" = lt.id
  )
  SELECT * FROM location_tree;
$$ LANGUAGE sql STABLE;

-- Kit RPC functions (from 011)
CREATE OR REPLACE FUNCTION kit_assign_custody(
  p_kit_id text, p_custodian_id text, p_asset_ids text[]
) RETURNS jsonb AS $$
DECLARE v_kit jsonb;
BEGIN
  INSERT INTO "KitCustody" ("custodianId", "kitId")
    VALUES (p_custodian_id, p_kit_id) ON CONFLICT DO NOTHING;
  UPDATE "Kit" SET status = 'IN_CUSTODY'::kit_status WHERE id = p_kit_id;
  INSERT INTO "Custody" ("assetId", "teamMemberId")
    SELECT unnest(p_asset_ids), p_custodian_id
    ON CONFLICT ("assetId") DO NOTHING;
  UPDATE "Asset" SET status = 'IN_CUSTODY'::asset_status
    WHERE id = ANY(p_asset_ids);
  SELECT to_jsonb("Kit".*) INTO v_kit FROM "Kit" WHERE id = p_kit_id;
  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION kit_release_custody(
  p_kit_id text, p_asset_ids text[]
) RETURNS jsonb AS $$
DECLARE v_kit jsonb;
BEGIN
  DELETE FROM "KitCustody" WHERE "kitId" = p_kit_id;
  UPDATE "Kit" SET status = 'AVAILABLE'::kit_status WHERE id = p_kit_id;
  DELETE FROM "Custody" WHERE "assetId" = ANY(p_asset_ids);
  UPDATE "Asset" SET status = 'AVAILABLE'::asset_status
    WHERE id = ANY(p_asset_ids);
  SELECT to_jsonb("Kit".*) INTO v_kit FROM "Kit" WHERE id = p_kit_id;
  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION kit_update_with_assets(
  p_kit_id text, p_data jsonb,
  p_add_asset_ids text[], p_remove_asset_ids text[]
) RETURNS jsonb AS $$
DECLARE v_kit jsonb;
BEGIN
  UPDATE "Kit" SET
    name = COALESCE(p_data->>'name', name),
    description = COALESCE(p_data->>'description', description),
    status = COALESCE((p_data->>'status')::kit_status, status),
    "updatedAt" = now()
  WHERE id = p_kit_id;
  IF array_length(p_add_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET "kitId" = p_kit_id WHERE id = ANY(p_add_asset_ids);
  END IF;
  IF array_length(p_remove_asset_ids, 1) > 0 THEN
    UPDATE "Asset" SET "kitId" = NULL WHERE id = ANY(p_remove_asset_ids);
  END IF;
  SELECT to_jsonb("Kit".*) INTO v_kit FROM "Kit" WHERE id = p_kit_id;
  RETURN v_kit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION kit_delete_with_cleanup(
  p_kit_id text, p_asset_ids text[]
) RETURNS void AS $$
BEGIN
  DELETE FROM "KitCustody" WHERE "kitId" = p_kit_id;
  DELETE FROM "Custody" WHERE "assetId" = ANY(p_asset_ids);
  UPDATE "Asset" SET status = 'AVAILABLE'::asset_status, "kitId" = NULL
    WHERE id = ANY(p_asset_ids);
  DELETE FROM "Kit" WHERE id = p_kit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_kit_assign_custody(
  p_kit_ids text[], p_custodian_id text
) RETURNS void AS $$
BEGIN
  INSERT INTO "KitCustody" ("custodianId", "kitId")
    SELECT p_custodian_id, unnest(p_kit_ids) ON CONFLICT DO NOTHING;
  UPDATE "Kit" SET status = 'IN_CUSTODY'::kit_status
    WHERE id = ANY(p_kit_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bulk_kit_release_custody(
  p_kit_ids text[]
) RETURNS void AS $$
BEGIN
  DELETE FROM "KitCustody" WHERE "kitId" = ANY(p_kit_ids);
  UPDATE "Kit" SET status = 'AVAILABLE'::kit_status
    WHERE id = ANY(p_kit_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_custom_field_from_index_settings(
  p_custom_field_name text, p_organization_id text
) RETURNS void AS $$
BEGIN
  UPDATE "AssetIndexSettings"
    SET columns = columns - p_custom_field_name, "updatedAt" = now()
    WHERE "organizationId" = p_organization_id
      AND columns ? p_custom_field_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
