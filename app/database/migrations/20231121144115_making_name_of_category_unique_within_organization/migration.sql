/*
  Warnings:

  - A unique constraint covering the columns `[name,organizationId]` on the table `Category` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Category_name_organizationId_key" ON "Category"("name", "organizationId");
