-- CreateTable
CREATE TABLE "BookingSettings" (
    "id" TEXT NOT NULL,
    "bufferStartTime" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingSettings_organizationId_key" ON "BookingSettings"("organizationId");

-- CreateIndex
CREATE INDEX "BookingSettings_organizationId_idx" ON "BookingSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "BookingSettings" ADD CONSTRAINT "BookingSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "BookingSettings" ENABLE row level security;
