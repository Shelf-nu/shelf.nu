-- CreateTable
CREATE TABLE "UserContact" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "street" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "zipPostalCode" TEXT,
    "countryRegion" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserContact_userId_key" ON "UserContact"("userId");

-- CreateIndex
CREATE INDEX "UserContact_userId_idx" ON "UserContact"("userId");

-- CreateIndex
CREATE INDEX "UserContact_phone_idx" ON "UserContact"("phone");

-- CreateIndex
CREATE INDEX "UserContact_city_stateProvince_idx" ON "UserContact"("city", "stateProvince");

-- CreateIndex
CREATE INDEX "UserContact_countryRegion_idx" ON "UserContact"("countryRegion");

-- CreateIndex
CREATE INDEX "UserContact_zipPostalCode_idx" ON "UserContact"("zipPostalCode");

-- CreateIndex
CREATE INDEX "UserContact_city_countryRegion_idx" ON "UserContact"("city", "countryRegion");

-- AddForeignKey
ALTER TABLE "UserContact" ADD CONSTRAINT "UserContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "UserContact" ENABLE row level security;