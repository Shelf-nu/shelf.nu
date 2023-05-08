/*
  Warnings:

  - Added the required column `email` to the `ReportFound` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ReportFound" ADD COLUMN     "email" TEXT NOT NULL;
