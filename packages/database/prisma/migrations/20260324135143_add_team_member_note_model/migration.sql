-- CreateTable
CREATE TABLE "TeamMemberNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "NoteType" NOT NULL DEFAULT 'COMMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "teamMemberId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "TeamMemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamMemberNote_teamMemberId_idx" ON "TeamMemberNote"("teamMemberId");

-- CreateIndex
CREATE INDEX "TeamMemberNote_userId_idx" ON "TeamMemberNote"("userId");

-- CreateIndex
CREATE INDEX "TeamMemberNote_organizationId_idx" ON "TeamMemberNote"("organizationId");

-- CreateIndex
CREATE INDEX "TeamMemberNote_teamMemberId_organizationId_idx" ON "TeamMemberNote"("teamMemberId", "organizationId");

-- AddForeignKey
ALTER TABLE "TeamMemberNote" ADD CONSTRAINT "TeamMemberNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberNote" ADD CONSTRAINT "TeamMemberNote_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberNote" ADD CONSTRAINT "TeamMemberNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
alter table "TeamMemberNote" ENABLE row level security;