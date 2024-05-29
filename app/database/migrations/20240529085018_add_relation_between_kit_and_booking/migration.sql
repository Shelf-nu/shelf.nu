-- CreateTable
CREATE TABLE "_BookingToKit" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_BookingToKit_AB_unique" ON "_BookingToKit"("A", "B");

-- CreateIndex
CREATE INDEX "_BookingToKit_B_index" ON "_BookingToKit"("B");

-- AddForeignKey
ALTER TABLE "_BookingToKit" ADD CONSTRAINT "_BookingToKit_A_fkey" FOREIGN KEY ("A") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingToKit" ADD CONSTRAINT "_BookingToKit_B_fkey" FOREIGN KEY ("B") REFERENCES "Kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
