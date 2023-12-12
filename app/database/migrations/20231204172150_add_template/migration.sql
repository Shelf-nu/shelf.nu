-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('CUSTODY', 'BOOKINGS');

-- AlterTable
ALTER TABLE "TierLimit" ADD COLUMN     "maxTemplates" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pdfSize" INTEGER,
    "pdfUrl" TEXT,
    "pdfName" TEXT,
    "type" "TemplateType" NOT NULL DEFAULT 'BOOKINGS',
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Template" ADD CONSTRAINT "Template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enable RLS
ALTER TABLE "Template" ENABLE row level security;
