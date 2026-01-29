-- CreateTable
CREATE TABLE "LocationNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "NoteType" NOT NULL DEFAULT 'COMMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "LocationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationNote_locationId_idx" ON "LocationNote"("locationId");

-- CreateIndex
CREATE INDEX "LocationNote_userId_idx" ON "LocationNote"("userId");

-- AddForeignKey
ALTER TABLE "LocationNote" ADD CONSTRAINT "LocationNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationNote" ADD CONSTRAINT "LocationNote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "LocationNote" ENABLE row level security;
