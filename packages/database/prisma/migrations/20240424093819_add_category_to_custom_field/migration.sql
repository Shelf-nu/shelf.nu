-- CreateTable
CREATE TABLE "_CategoryToCustomField" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_CategoryToCustomField_AB_unique" ON "_CategoryToCustomField"("A", "B");

-- CreateIndex
CREATE INDEX "_CategoryToCustomField_B_index" ON "_CategoryToCustomField"("B");

-- AddForeignKey
ALTER TABLE "_CategoryToCustomField" ADD CONSTRAINT "_CategoryToCustomField_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToCustomField" ADD CONSTRAINT "_CategoryToCustomField_B_fkey" FOREIGN KEY ("B") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
