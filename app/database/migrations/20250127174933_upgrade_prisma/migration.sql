-- AlterTable
ALTER TABLE "_AssetReminderToTeamMember" ADD CONSTRAINT "_AssetReminderToTeamMember_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_AssetReminderToTeamMember_AB_unique";

-- AlterTable
ALTER TABLE "_AssetToBooking" ADD CONSTRAINT "_AssetToBooking_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_AssetToBooking_AB_unique";

-- AlterTable
ALTER TABLE "_AssetToTag" ADD CONSTRAINT "_AssetToTag_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_AssetToTag_AB_unique";

-- AlterTable
ALTER TABLE "_CategoryToCustomField" ADD CONSTRAINT "_CategoryToCustomField_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_CategoryToCustomField_AB_unique";

-- AlterTable
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_RoleToUser_AB_unique";
