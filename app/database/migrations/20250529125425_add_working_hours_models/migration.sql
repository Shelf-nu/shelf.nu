-- CreateTable
CREATE TABLE "WorkingHours" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklySchedule" JSONB NOT NULL DEFAULT '{"0":{"isOpen":false},"1":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"2":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"3":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"4":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"5":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"6":{"isOpen":false}}',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHoursOverride" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openTime" TEXT,
    "closeTime" TEXT,
    "reason" TEXT,
    "workingHoursId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHoursOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHours_organizationId_key" ON "WorkingHours"("organizationId");

-- CreateIndex
CREATE INDEX "WorkingHours_organizationId_idx" ON "WorkingHours"("organizationId");

-- CreateIndex
CREATE INDEX "WorkingHoursOverride_workingHoursId_date_idx" ON "WorkingHoursOverride"("workingHoursId", "date");

-- CreateIndex
CREATE INDEX "WorkingHoursOverride_date_isOpen_idx" ON "WorkingHoursOverride"("date", "isOpen");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHoursOverride_workingHoursId_date_key" ON "WorkingHoursOverride"("workingHoursId", "date");

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHoursOverride" ADD CONSTRAINT "WorkingHoursOverride_workingHoursId_fkey" FOREIGN KEY ("workingHoursId") REFERENCES "WorkingHours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "WorkingHours" ENABLE row level security;
ALTER TABLE "WorkingHoursOverride" ENABLE row level security;