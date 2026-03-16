-- All indexes: Replicates every @@index, @@unique, and GIN index from the
-- Prisma schema. Organized by table.

-- ============================================================
-- Image
-- ============================================================
CREATE INDEX "Image_ownerOrgId_idx" ON "Image"("ownerOrgId");
CREATE INDEX "Image_userId_idx" ON "Image"("userId");

-- ============================================================
-- User
-- ============================================================
CREATE INDEX "User_firstName_lastName_idx" ON "User"("firstName", "lastName");
CREATE INDEX "User_tierId_idx" ON "User"("tierId");
CREATE INDEX "User_lastSelectedOrganizationId_idx" ON "User"("lastSelectedOrganizationId");

-- ============================================================
-- UserContact
-- ============================================================
CREATE INDEX "UserContact_userId_idx" ON "UserContact"("userId");
CREATE INDEX "UserContact_phone_idx" ON "UserContact"("phone");
CREATE INDEX "UserContact_city_stateProvince_idx" ON "UserContact"("city", "stateProvince");
CREATE INDEX "UserContact_countryRegion_idx" ON "UserContact"("countryRegion");
CREATE INDEX "UserContact_zipPostalCode_idx" ON "UserContact"("zipPostalCode");
CREATE INDEX "UserContact_city_countryRegion_idx" ON "UserContact"("city", "countryRegion");

-- ============================================================
-- UserBusinessIntel
-- ============================================================
CREATE INDEX "UserBusinessIntel_userId_idx" ON "UserBusinessIntel"("userId");
CREATE INDEX "UserBusinessIntel_companyName_idx" ON "UserBusinessIntel"("companyName");
CREATE INDEX "UserBusinessIntel_jobTitle_idx" ON "UserBusinessIntel"("jobTitle");
CREATE INDEX "UserBusinessIntel_teamSize_idx" ON "UserBusinessIntel"("teamSize");

-- ============================================================
-- Organization
-- ============================================================
CREATE INDEX "Organization_userId_idx" ON "Organization"("userId");
CREATE INDEX "Organization_ssoDetailsId_idx" ON "Organization"("ssoDetailsId");

-- ============================================================
-- UserOrganization
-- ============================================================
CREATE INDEX "UserOrganization_organizationId_idx" ON "UserOrganization"("organizationId");

-- ============================================================
-- Asset
-- ============================================================
-- GIN trigram index for search
CREATE INDEX "Asset_title_description_gin_idx"
  ON "Asset" USING gin ("title" gin_trgm_ops, "description" gin_trgm_ops);

-- Compound indexes for common query patterns
CREATE INDEX "Asset_organizationId_compound_idx"
  ON "Asset"("organizationId", "title", "status", "availableToBook");
CREATE INDEX "Asset_status_organizationId_idx"
  ON "Asset"("status", "organizationId");
CREATE INDEX "Asset_createdAt_organizationId_idx"
  ON "Asset"("createdAt", "organizationId");
CREATE INDEX "Asset_valuation_organizationId_idx"
  ON "Asset"("value", "organizationId");
CREATE INDEX "Asset_categoryId_organizationId_idx"
  ON "Asset"("categoryId", "organizationId");
CREATE INDEX "Asset_locationId_organizationId_idx"
  ON "Asset"("locationId", "organizationId");
CREATE INDEX "Asset_kitId_organizationId_idx"
  ON "Asset"("kitId", "organizationId");
CREATE INDEX "Asset_sequentialId_idx"
  ON "Asset"("sequentialId");
CREATE INDEX "Asset_userId_idx"
  ON "Asset"("userId");

-- ============================================================
-- AssetFilterPreset
-- ============================================================
CREATE INDEX "asset_filter_presets_owner_lookup_idx"
  ON "AssetFilterPreset"("organizationId", "ownerId");

-- ============================================================
-- AssetIndexSettings
-- ============================================================
CREATE INDEX "AssetIndexSettings_organizationId_idx"
  ON "AssetIndexSettings"("organizationId");

-- ============================================================
-- Category
-- ============================================================
CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");
CREATE INDEX "Category_userId_idx" ON "Category"("userId");

-- ============================================================
-- Tag
-- ============================================================
CREATE INDEX "Tag_organizationId_idx" ON "Tag"("organizationId");
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- ============================================================
-- Note
-- ============================================================
CREATE INDEX "Note_assetId_idx" ON "Note"("assetId");
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- ============================================================
-- BookingNote
-- ============================================================
CREATE INDEX "BookingNote_bookingId_idx" ON "BookingNote"("bookingId");
CREATE INDEX "BookingNote_userId_idx" ON "BookingNote"("userId");

-- ============================================================
-- LocationNote
-- ============================================================
CREATE INDEX "LocationNote_locationId_idx" ON "LocationNote"("locationId");
CREATE INDEX "LocationNote_userId_idx" ON "LocationNote"("userId");

-- ============================================================
-- Qr
-- ============================================================
CREATE INDEX "Qr_assetId_idx" ON "Qr"("assetId");
CREATE INDEX "Qr_kitId_idx" ON "Qr"("kitId");
CREATE INDEX "Qr_userId_idx" ON "Qr"("userId");
CREATE INDEX "Qr_organizationId_idx" ON "Qr"("organizationId");
CREATE INDEX "Qr_batchId_idx" ON "Qr"("batchId");

-- ============================================================
-- Barcode
-- ============================================================
CREATE INDEX "Barcode_organizationId_value_idx" ON "Barcode"("organizationId", "value");
CREATE INDEX "Barcode_assetId_idx" ON "Barcode"("assetId");
CREATE INDEX "Barcode_kitId_idx" ON "Barcode"("kitId");
CREATE INDEX "Barcode_organizationId_idx" ON "Barcode"("organizationId");

-- ============================================================
-- Scan
-- ============================================================
CREATE INDEX "Scan_qrId_idx" ON "Scan"("qrId");
CREATE INDEX "Scan_userId_idx" ON "Scan"("userId");

-- ============================================================
-- Location
-- ============================================================
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");
CREATE INDEX "Location_userId_idx" ON "Location"("userId");
CREATE INDEX "Location_organizationId_parentId_idx" ON "Location"("organizationId", "parentId");

-- ============================================================
-- TeamMember
-- ============================================================
-- GIN trigram index for search
CREATE INDEX "TeamMember_name_gin_idx"
  ON "TeamMember" USING gin ("name" gin_trgm_ops);
CREATE INDEX "TeamMember_organizationId_idx" ON "TeamMember"("organizationId");
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- ============================================================
-- Custody
-- ============================================================
CREATE INDEX "Custody_assetId_teamMemberId_idx"
  ON "Custody"("assetId", "teamMemberId");
CREATE INDEX "Custody_teamMemberId_idx" ON "Custody"("teamMemberId");

-- ============================================================
-- KitCustody
-- ============================================================
CREATE INDEX "KitCustody_custodianId_idx" ON "KitCustody"("custodianId");

-- ============================================================
-- Kit
-- ============================================================
CREATE INDEX "Kit_createdById_idx" ON "Kit"("createdById");
CREATE INDEX "Kit_organizationId_idx" ON "Kit"("organizationId");
CREATE INDEX "Kit_categoryId_organizationId_idx"
  ON "Kit"("categoryId", "organizationId");
CREATE INDEX "Kit_categoryId_organizationId_createdAt_idx"
  ON "Kit"("categoryId", "organizationId", "createdAt");
CREATE INDEX "Kit_categoryId_organizationId_name_idx"
  ON "Kit"("categoryId", "organizationId", "name");
CREATE INDEX "Kit_categoryId_organizationId_status_idx"
  ON "Kit"("categoryId", "organizationId", "status");

-- ============================================================
-- Invite
-- ============================================================
CREATE INDEX "Invite_inviteeUserId_idx" ON "Invite"("inviteeUserId");
CREATE INDEX "Invite_inviterId_idx" ON "Invite"("inviterId");
CREATE INDEX "Invite_organizationId_idx" ON "Invite"("organizationId");
CREATE INDEX "Invite_teamMemberId_idx" ON "Invite"("teamMemberId");

-- ============================================================
-- Booking
-- ============================================================
CREATE INDEX "Booking_creatorId_idx" ON "Booking"("creatorId");
CREATE INDEX "Booking_custodianTeamMemberId_idx" ON "Booking"("custodianTeamMemberId");
CREATE INDEX "Booking_custodianUserId_idx" ON "Booking"("custodianUserId");
CREATE INDEX "Booking_organizationId_idx" ON "Booking"("organizationId");

-- ============================================================
-- BookingSettings
-- ============================================================
CREATE INDEX "BookingSettings_organizationId_idx" ON "BookingSettings"("organizationId");

-- ============================================================
-- PartialBookingCheckin
-- ============================================================
CREATE INDEX "PartialBookingCheckin_bookingId_idx"
  ON "PartialBookingCheckin"("bookingId");
CREATE INDEX "PartialBookingCheckin_checkedInById_idx"
  ON "PartialBookingCheckin"("checkedInById");
CREATE INDEX "PartialBookingCheckin_checkinTimestamp_idx"
  ON "PartialBookingCheckin"("checkinTimestamp");
CREATE INDEX "PartialBookingCheckin_bookingId_checkinTimestamp_idx"
  ON "PartialBookingCheckin"("bookingId", "checkinTimestamp");

-- ============================================================
-- WorkingHours
-- ============================================================
CREATE INDEX "WorkingHours_organizationId_idx" ON "WorkingHours"("organizationId");

-- ============================================================
-- WorkingHoursOverride
-- ============================================================
CREATE INDEX "WorkingHoursOverride_workingHoursId_date_idx"
  ON "WorkingHoursOverride"("workingHoursId", "date");
CREATE INDEX "WorkingHoursOverride_date_isOpen_idx"
  ON "WorkingHoursOverride"("date", "isOpen");

-- ============================================================
-- CustomField
-- ============================================================
CREATE INDEX "CustomField_organizationId_idx" ON "CustomField"("organizationId");
CREATE INDEX "CustomField_userId_idx" ON "CustomField"("userId");
CREATE INDEX "CustomField_organizationId_deletedAt_idx"
  ON "CustomField"("organizationId", "deletedAt");

-- ============================================================
-- AssetCustomFieldValue
-- ============================================================
CREATE INDEX "AssetCustomFieldValue_lookup_idx"
  ON "AssetCustomFieldValue"("assetId", "customFieldId");
CREATE INDEX "AssetCustomFieldValue_customFieldId_idx"
  ON "AssetCustomFieldValue"("customFieldId");

-- ============================================================
-- AssetReminder
-- ============================================================
CREATE INDEX "AssetReminder_assetId_alertDateTime_idx"
  ON "AssetReminder"("assetId", "alertDateTime");
-- GIN trigram index for search
CREATE INDEX "AssetReminder_name_message_gin_idx"
  ON "AssetReminder" USING gin ("name" gin_trgm_ops, "message" gin_trgm_ops);
CREATE INDEX "AssetReminder_organizationId_alertDateTime_assetId_idx"
  ON "AssetReminder"("organizationId", "alertDateTime", "assetId");
CREATE INDEX "AssetReminder_alertDateTime_activeSchedulerReference_idx"
  ON "AssetReminder"("alertDateTime", "activeSchedulerReference");
CREATE INDEX "AssetReminder_createdById_idx"
  ON "AssetReminder"("createdById");

-- ============================================================
-- ReportFound
-- ============================================================
CREATE INDEX "ReportFound_assetId_idx" ON "ReportFound"("assetId");
CREATE INDEX "ReportFound_kitId_idx" ON "ReportFound"("kitId");

-- ============================================================
-- Update
-- ============================================================
CREATE INDEX "Update_status_publishDate_idx" ON "Update"("status", "publishDate");
CREATE INDEX "Update_publishDate_idx" ON "Update"("publishDate");
CREATE INDEX "Update_createdById_idx" ON "Update"("createdById");

-- ============================================================
-- UserUpdateRead
-- ============================================================
CREATE INDEX "UserUpdateRead_userId_idx" ON "UserUpdateRead"("userId");
CREATE INDEX "UserUpdateRead_updateId_idx" ON "UserUpdateRead"("updateId");
CREATE INDEX "UserUpdateRead_readAt_idx" ON "UserUpdateRead"("readAt");

-- ============================================================
-- AuditSession
-- ============================================================
CREATE INDEX "AuditSession_organizationId_status_idx"
  ON "AuditSession"("organizationId", "status");
CREATE INDEX "AuditSession_createdById_idx"
  ON "AuditSession"("createdById");
CREATE INDEX "AuditSession_status_createdAt_idx"
  ON "AuditSession"("status", "createdAt");

-- ============================================================
-- AuditAssignment
-- ============================================================
CREATE INDEX "AuditAssignment_userId_idx" ON "AuditAssignment"("userId");

-- ============================================================
-- AuditAsset
-- ============================================================
CREATE INDEX "AuditAsset_status_idx" ON "AuditAsset"("status");
CREATE INDEX "AuditAsset_scannedById_idx" ON "AuditAsset"("scannedById");

-- ============================================================
-- AuditScan
-- ============================================================
CREATE INDEX "AuditScan_auditSessionId_scannedAt_idx"
  ON "AuditScan"("auditSessionId", "scannedAt");
CREATE INDEX "AuditScan_auditAssetId_idx" ON "AuditScan"("auditAssetId");
CREATE INDEX "AuditScan_assetId_idx" ON "AuditScan"("assetId");

-- ============================================================
-- AuditNote
-- ============================================================
CREATE INDEX "AuditNote_auditSessionId_idx" ON "AuditNote"("auditSessionId");
CREATE INDEX "AuditNote_userId_idx" ON "AuditNote"("userId");
CREATE INDEX "AuditNote_auditAssetId_idx" ON "AuditNote"("auditAssetId");

-- ============================================================
-- AuditImage
-- ============================================================
CREATE INDEX "AuditImage_auditSessionId_idx" ON "AuditImage"("auditSessionId");
CREATE INDEX "AuditImage_auditAssetId_idx" ON "AuditImage"("auditAssetId");
CREATE INDEX "AuditImage_organizationId_idx" ON "AuditImage"("organizationId");
CREATE INDEX "AuditImage_uploadedById_idx" ON "AuditImage"("uploadedById");

-- ============================================================
-- RoleChangeLog
-- ============================================================
CREATE INDEX "RoleChangeLog_userId_organizationId_idx"
  ON "RoleChangeLog"("userId", "organizationId");
CREATE INDEX "RoleChangeLog_organizationId_createdAt_idx"
  ON "RoleChangeLog"("organizationId", "createdAt");
