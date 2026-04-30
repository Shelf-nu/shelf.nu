-- CreateEnum
CREATE TYPE "ActivityEntity" AS ENUM ('ASSET', 'BOOKING', 'AUDIT', 'KIT', 'LOCATION', 'TEAM_MEMBER', 'CUSTODY', 'USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('ASSET_CREATED', 'ASSET_NAME_CHANGED', 'ASSET_DESCRIPTION_CHANGED', 'ASSET_CATEGORY_CHANGED', 'ASSET_KIT_CHANGED', 'ASSET_LOCATION_CHANGED', 'ASSET_TAGS_CHANGED', 'ASSET_STATUS_CHANGED', 'ASSET_VALUATION_CHANGED', 'ASSET_CUSTOM_FIELD_CHANGED', 'ASSET_ARCHIVED', 'ASSET_DELETED', 'CUSTODY_ASSIGNED', 'CUSTODY_RELEASED', 'BOOKING_CREATED', 'BOOKING_STATUS_CHANGED', 'BOOKING_DATES_CHANGED', 'BOOKING_ASSETS_ADDED', 'BOOKING_ASSETS_REMOVED', 'BOOKING_CHECKED_OUT', 'BOOKING_CHECKED_IN', 'BOOKING_PARTIAL_CHECKIN', 'BOOKING_CANCELLED', 'BOOKING_ARCHIVED', 'AUDIT_CREATED', 'AUDIT_STARTED', 'AUDIT_ASSETS_ADDED', 'AUDIT_ASSETS_REMOVED', 'AUDIT_ASSET_SCANNED', 'AUDIT_ASSET_SCAN_REMOVED', 'AUDIT_DUE_DATE_CHANGED', 'AUDIT_ASSIGNEE_ADDED', 'AUDIT_ASSIGNEE_REMOVED', 'AUDIT_UPDATED', 'AUDIT_COMPLETED', 'AUDIT_CANCELLED', 'AUDIT_ARCHIVED', 'LOCATION_CREATED', 'LOCATION_UPDATED', 'KIT_CREATED', 'KIT_UPDATED');

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorSnapshot" JSONB,
    "action" "ActivityAction" NOT NULL,
    "entityType" "ActivityEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "assetId" TEXT,
    "bookingId" TEXT,
    "auditSessionId" TEXT,
    "auditAssetId" TEXT,
    "kitId" TEXT,
    "locationId" TEXT,
    "teamMemberId" TEXT,
    "targetUserId" TEXT,
    "field" TEXT,
    "fromValue" JSONB,
    "toValue" JSONB,
    "meta" JSONB,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_occurredAt_idx" ON "ActivityEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_action_occurredAt_idx" ON "ActivityEvent"("organizationId", "action", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_entityType_entityId_occurredAt_idx" ON "ActivityEvent"("organizationId", "entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_actorUserId_occurredAt_idx" ON "ActivityEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_assetId_occurredAt_idx" ON "ActivityEvent"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_bookingId_occurredAt_idx" ON "ActivityEvent"("bookingId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_auditSessionId_occurredAt_idx" ON "ActivityEvent"("auditSessionId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "ActivityEvent" ENABLE row level security;