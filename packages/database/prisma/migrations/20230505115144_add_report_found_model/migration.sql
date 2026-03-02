-- CreateTable
CREATE TABLE "ReportFound" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "ReportFound_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReportFound" ADD CONSTRAINT "ReportFound_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "ReportFound" ENABLE row level security;