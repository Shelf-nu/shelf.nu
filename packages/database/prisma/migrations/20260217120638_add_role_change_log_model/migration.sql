-- CreateTable
CREATE TABLE "RoleChangeLog" (
    "id" TEXT NOT NULL,
    "previousRole" "OrganizationRoles" NOT NULL,
    "newRole" "OrganizationRoles" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "RoleChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleChangeLog_userId_organizationId_idx" ON "RoleChangeLog"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "RoleChangeLog_organizationId_createdAt_idx" ON "RoleChangeLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoleChangeLog" ADD CONSTRAINT "RoleChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeLog" ADD CONSTRAINT "RoleChangeLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeLog" ADD CONSTRAINT "RoleChangeLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "RoleChangeLog" ENABLE row level security;