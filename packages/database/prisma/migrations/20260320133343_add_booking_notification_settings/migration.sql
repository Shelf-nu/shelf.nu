-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "notifyAdminsOnNewBooking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyBookingCreator" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "_BookingNotificationRecipients" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BookingNotificationRecipients_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_BookingSettingsAlwaysNotify" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BookingSettingsAlwaysNotify_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BookingNotificationRecipients_B_index" ON "_BookingNotificationRecipients"("B");

-- CreateIndex
CREATE INDEX "_BookingSettingsAlwaysNotify_B_index" ON "_BookingSettingsAlwaysNotify"("B");

-- AddForeignKey
ALTER TABLE "_BookingNotificationRecipients" ADD CONSTRAINT "_BookingNotificationRecipients_A_fkey" FOREIGN KEY ("A") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingNotificationRecipients" ADD CONSTRAINT "_BookingNotificationRecipients_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingSettingsAlwaysNotify" ADD CONSTRAINT "_BookingSettingsAlwaysNotify_A_fkey" FOREIGN KEY ("A") REFERENCES "BookingSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingSettingsAlwaysNotify" ADD CONSTRAINT "_BookingSettingsAlwaysNotify_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "_BookingNotificationRecipients" ENABLE row level security;
ALTER TABLE "_BookingSettingsAlwaysNotify" ENABLE row level security;