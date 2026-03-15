-- =============================================================================
-- 014_add_with_check_to_insert_policies.sql
-- Add explicit WITH CHECK clauses to T1 FOR ALL policies (review item #8).
--
-- Rationale:
--   PostgreSQL uses USING as WITH CHECK when no explicit WITH CHECK is
--   provided for INSERT operations under FOR ALL policies. While this
--   works correctly, explicit WITH CHECK makes the security intent clear
--   and prevents accidental cross-tenant INSERT if the policy structure
--   changes in the future.
--
--   This migration drops and recreates T1 policies that use USING with
--   org-scoped predicates, adding matching WITH CHECK clauses.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Direct org-scoped T1 policies (tables with organizationId column)
-- ---------------------------------------------------------------------------

-- Asset
DROP POLICY IF EXISTS "t1_asset_all" ON "Asset";
CREATE POLICY "t1_asset_all" ON "Asset"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Image
DROP POLICY IF EXISTS "t1_image_all" ON "Image";
CREATE POLICY "t1_image_all" ON "Image"
  FOR ALL
  USING ("ownerOrgId"::text = auth.tenant_id())
  WITH CHECK ("ownerOrgId"::text = auth.tenant_id());

-- Location
DROP POLICY IF EXISTS "t1_location_all" ON "Location";
CREATE POLICY "t1_location_all" ON "Location"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Category
DROP POLICY IF EXISTS "t1_category_all" ON "Category";
CREATE POLICY "t1_category_all" ON "Category"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Tag
DROP POLICY IF EXISTS "t1_tag_all" ON "Tag";
CREATE POLICY "t1_tag_all" ON "Tag"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Qr
DROP POLICY IF EXISTS "t1_qr_all" ON "Qr";
CREATE POLICY "t1_qr_all" ON "Qr"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Barcode
DROP POLICY IF EXISTS "t1_barcode_all" ON "Barcode";
CREATE POLICY "t1_barcode_all" ON "Barcode"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- TeamMember
DROP POLICY IF EXISTS "t1_team_member_all" ON "TeamMember";
CREATE POLICY "t1_team_member_all" ON "TeamMember"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- UserOrganization
DROP POLICY IF EXISTS "t1_user_org_all" ON "UserOrganization";
CREATE POLICY "t1_user_org_all" ON "UserOrganization"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- CustomField
DROP POLICY IF EXISTS "t1_custom_field_all" ON "CustomField";
CREATE POLICY "t1_custom_field_all" ON "CustomField"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Invite
DROP POLICY IF EXISTS "t1_invite_all" ON "Invite";
CREATE POLICY "t1_invite_all" ON "Invite"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Booking
DROP POLICY IF EXISTS "t1_booking_all" ON "Booking";
CREATE POLICY "t1_booking_all" ON "Booking"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- BookingSettings
DROP POLICY IF EXISTS "t1_booking_settings_all" ON "BookingSettings";
CREATE POLICY "t1_booking_settings_all" ON "BookingSettings"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- Kit
DROP POLICY IF EXISTS "t1_kit_all" ON "Kit";
CREATE POLICY "t1_kit_all" ON "Kit"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- AssetReminder
DROP POLICY IF EXISTS "t1_asset_reminder_all" ON "AssetReminder";
CREATE POLICY "t1_asset_reminder_all" ON "AssetReminder"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- WorkingHours
DROP POLICY IF EXISTS "t1_working_hours_all" ON "WorkingHours";
CREATE POLICY "t1_working_hours_all" ON "WorkingHours"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- AssetFilterPreset
DROP POLICY IF EXISTS "t1_asset_filter_preset_all" ON "AssetFilterPreset";
CREATE POLICY "t1_asset_filter_preset_all" ON "AssetFilterPreset"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- AssetIndexSettings
DROP POLICY IF EXISTS "t1_asset_index_settings_all" ON "AssetIndexSettings";
CREATE POLICY "t1_asset_index_settings_all" ON "AssetIndexSettings"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- AuditSession
DROP POLICY IF EXISTS "t1_audit_session_all" ON "AuditSession";
CREATE POLICY "t1_audit_session_all" ON "AuditSession"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- AuditImage
DROP POLICY IF EXISTS "t1_audit_image_all" ON "AuditImage";
CREATE POLICY "t1_audit_image_all" ON "AuditImage"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- RoleChangeLog
DROP POLICY IF EXISTS "t1_role_change_log_all" ON "RoleChangeLog";
CREATE POLICY "t1_role_change_log_all" ON "RoleChangeLog"
  FOR ALL
  USING ("organizationId"::text = auth.tenant_id())
  WITH CHECK ("organizationId"::text = auth.tenant_id());

-- ---------------------------------------------------------------------------
-- 2. New MSP tables (snake_case organization_id)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_person_all" ON person;
CREATE POLICY "t1_person_all" ON person
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

DROP POLICY IF EXISTS "t1_vendor_all" ON vendor;
CREATE POLICY "t1_vendor_all" ON vendor
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

DROP POLICY IF EXISTS "t1_software_application_all" ON software_application;
CREATE POLICY "t1_software_application_all" ON software_application
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

DROP POLICY IF EXISTS "t1_lease_all" ON lease;
CREATE POLICY "t1_lease_all" ON lease
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

DROP POLICY IF EXISTS "t1_activity_log_all" ON activity_log;
CREATE POLICY "t1_activity_log_all" ON activity_log
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

DROP POLICY IF EXISTS "t1_asset_status_config_all" ON asset_status_config;
CREATE POLICY "t1_asset_status_config_all" ON asset_status_config
  FOR ALL
  USING (organization_id::text = auth.tenant_id())
  WITH CHECK (organization_id::text = auth.tenant_id());

-- ---------------------------------------------------------------------------
-- 3. Organization policy (id-based, not organizationId)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_org_all" ON "Organization";
CREATE POLICY "t1_org_all" ON "Organization"
  FOR ALL
  USING (id::text = auth.tenant_id())
  WITH CHECK (id::text = auth.tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Parent-FK-scoped policies also get WITH CHECK
--    (subquery-based USING already validates the org relationship)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_note_all" ON "Note";
CREATE POLICY "t1_note_all" ON "Note"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Note"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Note"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_booking_note_all" ON "BookingNote";
CREATE POLICY "t1_booking_note_all" ON "BookingNote"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Booking" b WHERE b.id = "BookingNote"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Booking" b WHERE b.id = "BookingNote"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_location_note_all" ON "LocationNote";
CREATE POLICY "t1_location_note_all" ON "LocationNote"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Location" l WHERE l.id = "LocationNote"."locationId"
      AND l."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Location" l WHERE l.id = "LocationNote"."locationId"
      AND l."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_custody_all" ON "Custody";
CREATE POLICY "t1_custody_all" ON "Custody"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Custody"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Custody"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_kit_custody_all" ON "KitCustody";
CREATE POLICY "t1_kit_custody_all" ON "KitCustody"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Kit" k WHERE k.id = "KitCustody"."kitId"
      AND k."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Kit" k WHERE k.id = "KitCustody"."kitId"
      AND k."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_asset_cfv_all" ON "AssetCustomFieldValue";
CREATE POLICY "t1_asset_cfv_all" ON "AssetCustomFieldValue"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "AssetCustomFieldValue"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "AssetCustomFieldValue"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_partial_checkin_all" ON "PartialBookingCheckin";
CREATE POLICY "t1_partial_checkin_all" ON "PartialBookingCheckin"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Booking" b
      WHERE b.id = "PartialBookingCheckin"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Booking" b
      WHERE b.id = "PartialBookingCheckin"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_working_hours_override_all"
  ON "WorkingHoursOverride";
CREATE POLICY "t1_working_hours_override_all" ON "WorkingHoursOverride"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "WorkingHours" wh
      WHERE wh.id = "WorkingHoursOverride"."workingHoursId"
      AND wh."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "WorkingHours" wh
      WHERE wh.id = "WorkingHoursOverride"."workingHoursId"
      AND wh."organizationId"::text = auth.tenant_id()
  ));

-- asset_sync_source (MSP, scoped via Asset FK)
DROP POLICY IF EXISTS "t1_asset_sync_source_all" ON asset_sync_source;
CREATE POLICY "t1_asset_sync_source_all" ON asset_sync_source
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = asset_sync_source.asset_id
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = asset_sync_source.asset_id
      AND a."organizationId"::text = auth.tenant_id()
  ));

-- license_assignment (MSP, scoped via person FK)
DROP POLICY IF EXISTS "t1_license_assignment_all" ON license_assignment;
CREATE POLICY "t1_license_assignment_all" ON license_assignment
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM person p WHERE p.id = license_assignment.person_id
      AND p.organization_id::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM person p WHERE p.id = license_assignment.person_id
      AND p.organization_id::text = auth.tenant_id()
  ));

-- Audit tables
DROP POLICY IF EXISTS "t1_audit_assignment_all" ON "AuditAssignment";
CREATE POLICY "t1_audit_assignment_all" ON "AuditAssignment"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditAssignment"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditAssignment"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_audit_asset_all" ON "AuditAsset";
CREATE POLICY "t1_audit_asset_all" ON "AuditAsset"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditAsset"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditAsset"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_audit_scan_all" ON "AuditScan";
CREATE POLICY "t1_audit_scan_all" ON "AuditScan"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditScan"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditScan"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_audit_note_all" ON "AuditNote";
CREATE POLICY "t1_audit_note_all" ON "AuditNote"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditNote"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AuditSession" s
      WHERE s.id = "AuditNote"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 5. Join table policies (from 010) also get WITH CHECK
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_asset_to_tag_all" ON "_AssetToTag";
CREATE POLICY "t1_asset_to_tag_all" ON "_AssetToTag"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToTag"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToTag"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_asset_to_booking_all" ON "_AssetToBooking";
CREATE POLICY "t1_asset_to_booking_all" ON "_AssetToBooking"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToBooking"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToBooking"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_category_to_custom_field_all"
  ON "_CategoryToCustomField";
CREATE POLICY "t1_category_to_custom_field_all" ON "_CategoryToCustomField"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Category" c WHERE c.id = "_CategoryToCustomField"."A"
      AND c."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Category" c WHERE c.id = "_CategoryToCustomField"."A"
      AND c."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_tag_to_booking_all" ON "_TagToBooking";
CREATE POLICY "t1_tag_to_booking_all" ON "_TagToBooking"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Tag" t WHERE t.id = "_TagToBooking"."A"
      AND t."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Tag" t WHERE t.id = "_TagToBooking"."A"
      AND t."organizationId"::text = auth.tenant_id()
  ));

DROP POLICY IF EXISTS "t1_asset_reminder_to_tm_all"
  ON "_AssetReminderToTeamMember";
CREATE POLICY "t1_asset_reminder_to_tm_all" ON "_AssetReminderToTeamMember"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "AssetReminder" ar
      WHERE ar.id = "_AssetReminderToTeamMember"."A"
      AND ar."organizationId"::text = auth.tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AssetReminder" ar
      WHERE ar.id = "_AssetReminderToTeamMember"."A"
      AND ar."organizationId"::text = auth.tenant_id()
  ));
