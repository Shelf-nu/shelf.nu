-- =============================================================================
-- 005_rls_policies.sql
-- Enable Row Level Security on all tables and create T1/T2 policies
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Auth helper functions (extract tenant context from JWT)
--    Follows Stealth Peanut T0 pattern used in ChangeFlow
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.tenant_id() RETURNS text AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'tenant_id',
    ''
  )::text;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.tenant_tier() RETURNS text AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'tenant_tier',
    ''
  )::text;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.client_company_id() RETURNS text AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'client_company_id',
    ''
  )::text;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_id() RETURNS text AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::jsonb
      ->> 'sub',
    ''
  )::text;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on ALL tables
--    Tables dropped in 002 are excluded (Tier, TierLimit, CustomTierLimit,
--    SsoDetails, Announcement, UserBusinessIntel, _RoleToUser)
-- ---------------------------------------------------------------------------

-- Core tables with organization_id
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Image" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LocationNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Qr" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Barcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportFound" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Custody" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserOrganization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetCustomFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartialBookingCheckin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Kit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitCustody" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingHours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingHoursOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetFilterPreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetIndexSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditScan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleChangeLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Update" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserUpdateRead" ENABLE ROW LEVEL SECURITY;

-- User-scoped tables (no org_id, scoped by user identity)
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserContact" ENABLE ROW LEVEL SECURITY;

-- Global/reference tables
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrintBatch" ENABLE ROW LEVEL SECURITY;

-- Join tables
ALTER TABLE "_AssetToTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_AssetToBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_CategoryToCustomField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_TagToBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_AssetReminderToTeamMember" ENABLE ROW LEVEL SECURITY;

-- New MSP tables (from 004)
ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor ENABLE ROW LEVEL SECURITY;
ALTER TABLE software_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_sync_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_status_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. T1 policies (MSP staff) — full CRUD on all org-scoped data
-- ---------------------------------------------------------------------------

-- Helper: tables with direct organization_id column get this pattern
-- T1 sees all data within their MSP tenant

-- Organization
CREATE POLICY "t1_org_all" ON "Organization"
  FOR ALL USING (id::text = auth.tenant_id());

-- Tables with organizationId column (Shelf naming convention)
CREATE POLICY "t1_asset_all" ON "Asset"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_image_all" ON "Image"
  FOR ALL USING ("ownerOrgId"::text = auth.tenant_id());

CREATE POLICY "t1_location_all" ON "Location"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_category_all" ON "Category"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_tag_all" ON "Tag"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_qr_all" ON "Qr"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_barcode_all" ON "Barcode"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_team_member_all" ON "TeamMember"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_user_org_all" ON "UserOrganization"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_custom_field_all" ON "CustomField"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_invite_all" ON "Invite"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_booking_all" ON "Booking"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_booking_settings_all" ON "BookingSettings"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_kit_all" ON "Kit"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_asset_reminder_all" ON "AssetReminder"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_working_hours_all" ON "WorkingHours"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_asset_filter_preset_all" ON "AssetFilterPreset"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_asset_index_settings_all" ON "AssetIndexSettings"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_audit_session_all" ON "AuditSession"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_audit_image_all" ON "AuditImage"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

CREATE POLICY "t1_role_change_log_all" ON "RoleChangeLog"
  FOR ALL USING ("organizationId"::text = auth.tenant_id());

-- New MSP tables (snake_case organization_id)
CREATE POLICY "t1_person_all" ON person
  FOR ALL USING (organization_id::text = auth.tenant_id());

CREATE POLICY "t1_vendor_all" ON vendor
  FOR ALL USING (organization_id::text = auth.tenant_id());

CREATE POLICY "t1_software_application_all" ON software_application
  FOR ALL USING (organization_id::text = auth.tenant_id());

CREATE POLICY "t1_lease_all" ON lease
  FOR ALL USING (organization_id::text = auth.tenant_id());

CREATE POLICY "t1_asset_sync_source_all" ON asset_sync_source
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = asset_sync_source.asset_id
      AND a."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_activity_log_all" ON activity_log
  FOR ALL USING (organization_id::text = auth.tenant_id());

CREATE POLICY "t1_asset_status_config_all" ON asset_status_config
  FOR ALL USING (organization_id::text = auth.tenant_id());

-- Tables scoped via parent FK (no direct org_id)
CREATE POLICY "t1_note_all" ON "Note"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Note"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_booking_note_all" ON "BookingNote"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Booking" b WHERE b.id = "BookingNote"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_location_note_all" ON "LocationNote"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Location" l WHERE l.id = "LocationNote"."locationId"
      AND l."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_custody_all" ON "Custody"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "Custody"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_kit_custody_all" ON "KitCustody"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Kit" k WHERE k.id = "KitCustody"."kitId"
      AND k."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_asset_cfv_all" ON "AssetCustomFieldValue"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "AssetCustomFieldValue"."assetId"
      AND a."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_partial_checkin_all" ON "PartialBookingCheckin"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Booking" b WHERE b.id = "PartialBookingCheckin"."bookingId"
      AND b."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_working_hours_override_all" ON "WorkingHoursOverride"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "WorkingHours" wh WHERE wh.id = "WorkingHoursOverride"."workingHoursId"
      AND wh."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_scan_all" ON "Scan"
  FOR ALL USING (true);  -- Scans are cross-org readable for QR flows

CREATE POLICY "t1_report_found_all" ON "ReportFound"
  FOR ALL USING (true);  -- Report-found is public-facing

CREATE POLICY "t1_audit_assignment_all" ON "AuditAssignment"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "AuditSession" s WHERE s.id = "AuditAssignment"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_audit_asset_all" ON "AuditAsset"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "AuditSession" s WHERE s.id = "AuditAsset"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_audit_scan_all" ON "AuditScan"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "AuditSession" s WHERE s.id = "AuditScan"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_audit_note_all" ON "AuditNote"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "AuditSession" s WHERE s.id = "AuditNote"."auditSessionId"
      AND s."organizationId"::text = auth.tenant_id()
  ));

CREATE POLICY "t1_license_assignment_all" ON license_assignment
  FOR ALL USING (EXISTS (
    SELECT 1 FROM person p WHERE p.id = license_assignment.person_id
      AND p.organization_id::text = auth.tenant_id()
  ));

-- Join tables: allow via parent table access
CREATE POLICY "t1_asset_to_tag_all" ON "_AssetToTag"
  FOR ALL USING (true);

CREATE POLICY "t1_asset_to_booking_all" ON "_AssetToBooking"
  FOR ALL USING (true);

CREATE POLICY "t1_category_to_custom_field_all" ON "_CategoryToCustomField"
  FOR ALL USING (true);

CREATE POLICY "t1_tag_to_booking_all" ON "_TagToBooking"
  FOR ALL USING (true);

CREATE POLICY "t1_asset_reminder_to_tm_all" ON "_AssetReminderToTeamMember"
  FOR ALL USING (true);

-- User-scoped tables
CREATE POLICY "t1_user_all" ON "User"
  FOR ALL USING (true);  -- Users visible across org (for lookups)

CREATE POLICY "t1_user_contact_all" ON "UserContact"
  FOR ALL USING (true);

CREATE POLICY "t1_update_all" ON "Update"
  FOR ALL USING (true);

CREATE POLICY "t1_user_update_read_all" ON "UserUpdateRead"
  FOR ALL USING (true);

-- Global reference tables
CREATE POLICY "t1_role_all" ON "Role"
  FOR ALL USING (true);

CREATE POLICY "t1_print_batch_all" ON "PrintBatch"
  FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- 4. T2 policies (Client users) — read-only on their company's data
--    T2 users have tenant_tier = 'T2' and a client_company_id
-- ---------------------------------------------------------------------------

-- Organization: T2 sees only their own company
CREATE POLICY "t2_org_select" ON "Organization"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND id::text = auth.client_company_id()
  );

-- Assets: T2 sees their company's assets (excluding sync metadata via views)
CREATE POLICY "t2_asset_select" ON "Asset"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Person: T2 sees their company's people
CREATE POLICY "t2_person_select" ON person
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND organization_id::text = auth.client_company_id()
  );

-- Location: T2 sees their company's locations
CREATE POLICY "t2_location_select" ON "Location"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Category: T2 sees their company's categories
CREATE POLICY "t2_category_select" ON "Category"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Tag: T2 sees their company's tags
CREATE POLICY "t2_tag_select" ON "Tag"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Booking: T2 sees their company's bookings
CREATE POLICY "t2_booking_select" ON "Booking"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Kit: T2 sees their company's kits
CREATE POLICY "t2_kit_select" ON "Kit"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Custom fields: T2 sees their company's custom fields
CREATE POLICY "t2_custom_field_select" ON "CustomField"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Asset status config: T2 sees their company's statuses
CREATE POLICY "t2_asset_status_config_select" ON asset_status_config
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND organization_id::text = auth.client_company_id()
  );

-- TeamMember: T2 sees their company's team members
CREATE POLICY "t2_team_member_select" ON "TeamMember"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND "organizationId"::text = auth.client_company_id()
  );

-- Scan / ReportFound: T2 can use QR flows
CREATE POLICY "t2_scan_select" ON "Scan"
  FOR SELECT USING (auth.tenant_tier() = 'T2');

CREATE POLICY "t2_report_found_insert" ON "ReportFound"
  FOR INSERT WITH CHECK (auth.tenant_tier() = 'T2');

-- Activity log: T2 sees only their own company's logs
CREATE POLICY "t2_activity_log_select" ON activity_log
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND organization_id::text = auth.client_company_id()
  );

-- T2 CANNOT see: asset_sync_source, vendor, software_application,
-- license_assignment, lease (MSP-internal data)
-- No T2 policies created for these tables = no access
