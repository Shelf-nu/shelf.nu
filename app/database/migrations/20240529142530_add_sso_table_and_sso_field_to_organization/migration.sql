-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "enabledSso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ssoDetailsId" TEXT;

-- CreateTable
CREATE TABLE "SsoDetails" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoDetails_domain_key" ON "SsoDetails"("domain");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ssoDetailsId_fkey" FOREIGN KEY ("ssoDetailsId") REFERENCES "SsoDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Enable RLS
ALTER TABLE "SsoDetails" ENABLE row level security;