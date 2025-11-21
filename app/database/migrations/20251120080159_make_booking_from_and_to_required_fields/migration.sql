/*
  Warnings:

  - Made the column `from` on table `Booking` required. This step will fail if there are existing NULL values in that column.
  - Made the column `to` on table `Booking` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "from" SET NOT NULL,
ALTER COLUMN "to" SET NOT NULL;
