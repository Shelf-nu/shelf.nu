-- Companion-app push notifications: device tokens, per-user switches, and the
-- tier flag that gates sending. A user without a NotificationPreference row has
-- every switch on, so no backfill is needed.

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- AlterTable
ALTER TABLE "TierLimit" ADD COLUMN     "canUsePushNotifications" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomTierLimit" ADD COLUMN     "canUsePushNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bookings" BOOLEAN NOT NULL DEFAULT true,
    "audits" BOOLEAN NOT NULL DEFAULT true,
    "stockAndReminders" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "PushToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
