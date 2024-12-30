-- CreateTable
CREATE TABLE "AssetReminder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "alertDateTime" TIMESTAMP(3) NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AssetReminderToTeamMember" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AssetReminderToTeamMember_AB_unique" ON "_AssetReminderToTeamMember"("A", "B");

-- CreateIndex
CREATE INDEX "_AssetReminderToTeamMember_B_index" ON "_AssetReminderToTeamMember"("B");

-- AddForeignKey
ALTER TABLE "AssetReminder" ADD CONSTRAINT "AssetReminder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReminder" ADD CONSTRAINT "AssetReminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetReminderToTeamMember" ADD CONSTRAINT "_AssetReminderToTeamMember_A_fkey" FOREIGN KEY ("A") REFERENCES "AssetReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetReminderToTeamMember" ADD CONSTRAINT "_AssetReminderToTeamMember_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable Row level security
ALTER TABLE "AssetReminder" ENABLE row level security;