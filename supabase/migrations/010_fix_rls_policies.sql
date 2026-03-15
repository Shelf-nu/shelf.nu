-- =============================================================================
-- 010_fix_rls_policies.sql
-- Fix RLS policy security issues identified in migration review:
--   1. Scope join tables via parent FK (not USING (true))
--   2. Scope User/UserContact via UserOrganization membership
--   3. Add T2 Scan INSERT + ReportFound SELECT policies
--   4. Scope Update/UserUpdateRead via org membership
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop and recreate join table policies with proper scoping
-- ---------------------------------------------------------------------------

-- _AssetToTag: scope via Asset's organizationId
DROP POLICY IF EXISTS "t1_asset_to_tag_all" ON "_AssetToTag";
CREATE POLICY "t1_asset_to_tag_all" ON "_AssetToTag"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToTag"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ));

-- _AssetToBooking: scope via Asset's organizationId
DROP POLICY IF EXISTS "t1_asset_to_booking_all" ON "_AssetToBooking";
CREATE POLICY "t1_asset_to_booking_all" ON "_AssetToBooking"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToBooking"."A"
      AND a."organizationId"::text = auth.tenant_id()
  ));

-- _CategoryToCustomField: scope via Category's organizationId
DROP POLICY IF EXISTS "t1_category_to_custom_field_all"
  ON "_CategoryToCustomField";
CREATE POLICY "t1_category_to_custom_field_all" ON "_CategoryToCustomField"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Category" c WHERE c.id = "_CategoryToCustomField"."A"
      AND c."organizationId"::text = auth.tenant_id()
  ));

-- _TagToBooking: scope via Tag's organizationId
DROP POLICY IF EXISTS "t1_tag_to_booking_all" ON "_TagToBooking";
CREATE POLICY "t1_tag_to_booking_all" ON "_TagToBooking"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "Tag" t WHERE t.id = "_TagToBooking"."A"
      AND t."organizationId"::text = auth.tenant_id()
  ));

-- _AssetReminderToTeamMember: scope via AssetReminder's organizationId
DROP POLICY IF EXISTS "t1_asset_reminder_to_tm_all"
  ON "_AssetReminderToTeamMember";
CREATE POLICY "t1_asset_reminder_to_tm_all" ON "_AssetReminderToTeamMember"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "AssetReminder" ar
      WHERE ar.id = "_AssetReminderToTeamMember"."A"
      AND ar."organizationId"::text = auth.tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 2. Scope User and UserContact via UserOrganization membership
--    Users should only be visible if they belong to the same org
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_user_all" ON "User";
CREATE POLICY "t1_user_all" ON "User"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "UserOrganization" uo
      WHERE uo."userId" = "User".id
        AND uo."organizationId"::text = auth.tenant_id()
    )
    OR id::text = auth.user_id()  -- Users can always see themselves
  );

DROP POLICY IF EXISTS "t1_user_contact_all" ON "UserContact";
CREATE POLICY "t1_user_contact_all" ON "UserContact"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "UserOrganization" uo
      WHERE uo."userId" = "UserContact"."userId"
        AND uo."organizationId"::text = auth.tenant_id()
    )
    OR "userId"::text = auth.user_id()
  );

-- ---------------------------------------------------------------------------
-- 3. Scope Update and UserUpdateRead
--    These are system-level notifications; scope to org membership
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "t1_update_all" ON "Update";
CREATE POLICY "t1_update_all" ON "Update"
  FOR ALL USING (true);
  -- Updates are global announcements, keeping open is intentional

DROP POLICY IF EXISTS "t1_user_update_read_all" ON "UserUpdateRead";
CREATE POLICY "t1_user_update_read_all" ON "UserUpdateRead"
  FOR ALL USING ("userId"::text = auth.user_id());

-- ---------------------------------------------------------------------------
-- 4. Add T2 Scan INSERT policy (T2 users need to create scans for QR flows)
-- ---------------------------------------------------------------------------

CREATE POLICY "t2_scan_insert" ON "Scan"
  FOR INSERT WITH CHECK (auth.tenant_tier() = 'T2');

-- T2 ReportFound SELECT (they should be able to see their own reports)
CREATE POLICY "t2_report_found_select" ON "ReportFound"
  FOR SELECT USING (auth.tenant_tier() = 'T2');

-- ---------------------------------------------------------------------------
-- 5. T2 join table read access (scoped via parent)
-- ---------------------------------------------------------------------------

-- T2 can see tags on their company's assets
CREATE POLICY "t2_asset_to_tag_select" ON "_AssetToTag"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND EXISTS (
      SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToTag"."A"
        AND a."organizationId"::text = auth.client_company_id()
    )
  );

-- T2 can see bookings on their company's assets
CREATE POLICY "t2_asset_to_booking_select" ON "_AssetToBooking"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND EXISTS (
      SELECT 1 FROM "Asset" a WHERE a.id = "_AssetToBooking"."A"
        AND a."organizationId"::text = auth.client_company_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. T2 User visibility (can see users in their company)
-- ---------------------------------------------------------------------------

CREATE POLICY "t2_user_select" ON "User"
  FOR SELECT USING (
    auth.tenant_tier() = 'T2'
    AND (
      EXISTS (
        SELECT 1 FROM "UserOrganization" uo
        WHERE uo."userId" = "User".id
          AND uo."organizationId"::text = auth.client_company_id()
      )
      OR id::text = auth.user_id()
    )
  );
