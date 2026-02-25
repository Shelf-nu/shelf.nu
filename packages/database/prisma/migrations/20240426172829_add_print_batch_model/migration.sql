-- AlterTable
ALTER TABLE "Qr" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "printed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintBatch_name_key" ON "PrintBatch"("name");

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS for PrintBatch
ALTER TABLE "PrintBatch" ENABLE row level security;
