-- CreateTable
CREATE TABLE "AuditNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "NoteType" NOT NULL DEFAULT 'COMMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "auditSessionId" TEXT NOT NULL,

    CONSTRAINT "AuditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditNote_auditSessionId_idx" ON "AuditNote"("auditSessionId");

-- CreateIndex
CREATE INDEX "AuditNote_userId_idx" ON "AuditNote"("userId");

-- AddForeignKey
ALTER TABLE "AuditNote" ADD CONSTRAINT "AuditNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditNote" ADD CONSTRAINT "AuditNote_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "AuditNote" ENABLE row level security;
