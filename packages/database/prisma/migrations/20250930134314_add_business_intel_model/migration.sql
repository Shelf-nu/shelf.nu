-- CreateTable
CREATE TABLE "public"."UserBusinessIntel" (
    "id" TEXT NOT NULL,
    "howDidYouHearAboutUs" TEXT,
    "jobTitle" TEXT,
    "teamSize" TEXT,
    "companyName" TEXT,
    "primaryUseCase" TEXT,
    "currentSolution" TEXT,
    "timeline" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBusinessIntel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserBusinessIntel_userId_key" ON "public"."UserBusinessIntel"("userId");

-- CreateIndex
CREATE INDEX "UserBusinessIntel_userId_idx" ON "public"."UserBusinessIntel"("userId");

-- CreateIndex
CREATE INDEX "UserBusinessIntel_companyName_idx" ON "public"."UserBusinessIntel"("companyName");

-- CreateIndex
CREATE INDEX "UserBusinessIntel_jobTitle_idx" ON "public"."UserBusinessIntel"("jobTitle");

-- CreateIndex
CREATE INDEX "UserBusinessIntel_teamSize_idx" ON "public"."UserBusinessIntel"("teamSize");

-- AddForeignKey
ALTER TABLE "public"."UserBusinessIntel" ADD CONSTRAINT "UserBusinessIntel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "UserBusinessIntel" ENABLE row level security;