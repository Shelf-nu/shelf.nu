-- CreateTable
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScimExternalId" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scimExternalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScimExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScimToken_organizationId_idx" ON "ScimToken"("organizationId");

-- CreateIndex
CREATE INDEX "UserScimExternalId_organizationId_idx" ON "UserScimExternalId"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserScimExternalId_userId_organizationId_key" ON "UserScimExternalId"("userId", "organizationId");

-- CreateIndex
-- The SCIM-facing resource id is the per-org external id (the IdP object id), so
-- it must be unique within an org to safely resolve /Users/{id} lookups.
CREATE UNIQUE INDEX "UserScimExternalId_organizationId_scimExternalId_key" ON "UserScimExternalId"("organizationId", "scimExternalId");

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScimExternalId" ADD CONSTRAINT "UserScimExternalId_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScimExternalId" ADD CONSTRAINT "UserScimExternalId_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable Row Level Security to match every other table in the schema.
-- ScimToken stores SHA-256 hashes of bearer tokens; both tables are org-scoped.
ALTER TABLE "ScimToken" ENABLE row level security;
ALTER TABLE "UserScimExternalId" ENABLE row level security;
