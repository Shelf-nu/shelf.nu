-- CreateIndex
CREATE INDEX "Asset_title_description_idx" ON "Asset" USING GIN ("title" gin_trgm_ops, "description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "AssetReminder_assetId_alertDateTime_idx" ON "AssetReminder"("assetId", "alertDateTime");

-- CreateIndex
CREATE INDEX "AssetReminder_name_message_idx" ON "AssetReminder" USING GIN ("name" gin_trgm_ops, "message" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "AssetReminder_organizationId_alertDateTime_assetId_idx" ON "AssetReminder"("organizationId", "alertDateTime", "assetId");

-- CreateIndex
CREATE INDEX "AssetReminder_alertDateTime_activeSchedulerReference_idx" ON "AssetReminder"("alertDateTime", "activeSchedulerReference");

-- CreateIndex
CREATE INDEX "TeamMember_name_idx" ON "TeamMember" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_firstName_lastName_idx" ON "User"("firstName", "lastName");
