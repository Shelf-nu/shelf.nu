-- CreateIndex
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");

-- CreateIndex
CREATE INDEX "AssetCustomFieldValue_customFieldId_idx" ON "AssetCustomFieldValue"("customFieldId");

-- CreateIndex
CREATE INDEX "AssetIndexSettings_organizationId_idx" ON "AssetIndexSettings"("organizationId");

-- CreateIndex
CREATE INDEX "AssetReminder_createdById_idx" ON "AssetReminder"("createdById");

-- CreateIndex
CREATE INDEX "Booking_creatorId_idx" ON "Booking"("creatorId");

-- CreateIndex
CREATE INDEX "Booking_custodianTeamMemberId_idx" ON "Booking"("custodianTeamMemberId");

-- CreateIndex
CREATE INDEX "Booking_custodianUserId_idx" ON "Booking"("custodianUserId");

-- CreateIndex
CREATE INDEX "Booking_organizationId_idx" ON "Booking"("organizationId");

-- CreateIndex
CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");

-- CreateIndex
CREATE INDEX "Category_userId_idx" ON "Category"("userId");

-- CreateIndex
CREATE INDEX "Custody_teamMemberId_idx" ON "Custody"("teamMemberId");

-- CreateIndex
CREATE INDEX "CustomField_organizationId_idx" ON "CustomField"("organizationId");

-- CreateIndex
CREATE INDEX "CustomField_userId_idx" ON "CustomField"("userId");

-- CreateIndex
CREATE INDEX "Image_ownerOrgId_idx" ON "Image"("ownerOrgId");

-- CreateIndex
CREATE INDEX "Image_userId_idx" ON "Image"("userId");

-- CreateIndex
CREATE INDEX "Invite_inviteeUserId_idx" ON "Invite"("inviteeUserId");

-- CreateIndex
CREATE INDEX "Invite_inviterId_idx" ON "Invite"("inviterId");

-- CreateIndex
CREATE INDEX "Invite_organizationId_idx" ON "Invite"("organizationId");

-- CreateIndex
CREATE INDEX "Invite_teamMemberId_idx" ON "Invite"("teamMemberId");

-- CreateIndex
CREATE INDEX "Kit_createdById_idx" ON "Kit"("createdById");

-- CreateIndex
CREATE INDEX "Kit_organizationId_idx" ON "Kit"("organizationId");

-- CreateIndex
CREATE INDEX "KitCustody_custodianId_idx" ON "KitCustody"("custodianId");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Location_userId_idx" ON "Location"("userId");

-- CreateIndex
CREATE INDEX "Note_assetId_idx" ON "Note"("assetId");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE INDEX "Organization_userId_idx" ON "Organization"("userId");

-- CreateIndex
CREATE INDEX "Organization_ssoDetailsId_idx" ON "Organization"("ssoDetailsId");

-- CreateIndex
CREATE INDEX "Qr_kitId_idx" ON "Qr"("kitId");

-- CreateIndex
CREATE INDEX "Qr_userId_idx" ON "Qr"("userId");

-- CreateIndex
CREATE INDEX "Qr_organizationId_idx" ON "Qr"("organizationId");

-- CreateIndex
CREATE INDEX "Qr_batchId_idx" ON "Qr"("batchId");

-- CreateIndex
CREATE INDEX "ReportFound_assetId_idx" ON "ReportFound"("assetId");

-- CreateIndex
CREATE INDEX "ReportFound_kitId_idx" ON "ReportFound"("kitId");

-- CreateIndex
CREATE INDEX "Scan_qrId_idx" ON "Scan"("qrId");

-- CreateIndex
CREATE INDEX "Scan_userId_idx" ON "Scan"("userId");

-- CreateIndex
CREATE INDEX "Tag_organizationId_idx" ON "Tag"("organizationId");

-- CreateIndex
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_organizationId_idx" ON "TeamMember"("organizationId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "User_tierId_idx" ON "User"("tierId");

-- CreateIndex
CREATE INDEX "UserOrganization_organizationId_idx" ON "UserOrganization"("organizationId");
