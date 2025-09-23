-- CreateTable
CREATE TABLE "public"."BookingNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "public"."NoteType" NOT NULL DEFAULT 'COMMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "bookingId" TEXT NOT NULL,

    CONSTRAINT "BookingNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingNote_bookingId_idx" ON "public"."BookingNote"("bookingId");

-- CreateIndex
CREATE INDEX "BookingNote_userId_idx" ON "public"."BookingNote"("userId");

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
alter table "BookingNote" ENABLE row level security;