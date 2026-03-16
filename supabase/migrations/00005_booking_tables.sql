-- Booking tables: Booking, BookingNote, BookingSettings, PartialBookingCheckin,
-- WorkingHours, WorkingHoursOverride

-- ============================================================
-- Booking
-- ============================================================

CREATE TABLE "Booking" (
  "id"                       text            PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"                     text            NOT NULL,
  "status"                   "BookingStatus" NOT NULL DEFAULT 'DRAFT',
  "description"              text            DEFAULT '',
  "activeSchedulerReference" text,
  "creatorId"                text            NOT NULL,
  "custodianUserId"          text,
  "custodianTeamMemberId"    text,
  "organizationId"           text            NOT NULL,
  "createdAt"                timestamptz(3)  NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz(3)  NOT NULL DEFAULT now(),
  "from"                     timestamptz(3)  NOT NULL,
  "to"                       timestamptz(3)  NOT NULL,
  "originalFrom"             timestamptz(3),
  "originalTo"               timestamptz(3),
  "autoArchivedAt"           timestamptz(3),
  "cancellationReason"       text,

  CONSTRAINT "Booking_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Booking_custodianUserId_fkey"
    FOREIGN KEY ("custodianUserId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Booking_custodianTeamMemberId_fkey"
    FOREIGN KEY ("custodianTeamMemberId") REFERENCES "TeamMember"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "Booking_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- Booking-Asset junction (implicit many-to-many in Prisma)
-- ============================================================

CREATE TABLE "_AssetToBooking" (
  "A" text NOT NULL REFERENCES "Asset"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "Booking"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_AssetToBooking_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_AssetToBooking_B_index" ON "_AssetToBooking"("B");

-- ============================================================
-- Booking-Tag junction (implicit many-to-many in Prisma)
-- ============================================================

CREATE TABLE "_BookingToTag" (
  "A" text NOT NULL REFERENCES "Booking"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "Tag"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "_BookingToTag_AB_unique" UNIQUE ("A", "B")
);
CREATE INDEX "_BookingToTag_B_index" ON "_BookingToTag"("B");

-- ============================================================
-- BookingNote
-- ============================================================

CREATE TABLE "BookingNote" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "content"   text        NOT NULL,
  "type"      "NoteType"  NOT NULL DEFAULT 'COMMENT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "userId"    text,
  "bookingId" text        NOT NULL,

  CONSTRAINT "BookingNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "BookingNote_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- BookingSettings (per-organization)
-- ============================================================

CREATE TABLE "BookingSettings" (
  "id"                                      text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bufferStartTime"                         integer     NOT NULL DEFAULT 0,
  "tagsRequired"                            boolean     NOT NULL DEFAULT false,
  "maxBookingLength"                        integer,
  "maxBookingLengthSkipClosedDays"          boolean     NOT NULL DEFAULT false,
  "autoArchiveBookings"                     boolean     NOT NULL DEFAULT false,
  "autoArchiveDays"                         integer     NOT NULL DEFAULT 2,
  "requireExplicitCheckinForAdmin"          boolean     NOT NULL DEFAULT false,
  "requireExplicitCheckinForSelfService"    boolean     NOT NULL DEFAULT false,
  "organizationId"                          text        NOT NULL UNIQUE,
  "createdAt"                               timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "BookingSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- PartialBookingCheckin
-- ============================================================

CREATE TABLE "PartialBookingCheckin" (
  "id"                text           PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "assetIds"          text[]         NOT NULL DEFAULT '{}',
  "checkinCount"      integer        NOT NULL,
  "checkinTimestamp"  timestamptz(3) NOT NULL DEFAULT now(),
  "bookingId"         text           NOT NULL,
  "checkedInById"     text           NOT NULL,
  "createdAt"         timestamptz    NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT "PartialBookingCheckin_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "PartialBookingCheckin_checkedInById_fkey"
    FOREIGN KEY ("checkedInById") REFERENCES "User"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ============================================================
-- WorkingHours (per-organization)
-- ============================================================

CREATE TABLE "WorkingHours" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "enabled"        boolean     NOT NULL DEFAULT false,
  "weeklySchedule" jsonb       NOT NULL DEFAULT '{"0":{"isOpen":false},"1":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"2":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"3":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"4":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"5":{"isOpen":true,"openTime":"09:00","closeTime":"17:00"},"6":{"isOpen":false}}',
  "organizationId" text        NOT NULL UNIQUE,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "WorkingHours_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ============================================================
-- WorkingHoursOverride
-- ============================================================

CREATE TABLE "WorkingHoursOverride" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "date"           date        NOT NULL,
  "isOpen"         boolean     NOT NULL DEFAULT false,
  "openTime"       text,
  "closeTime"      text,
  "reason"         text,
  "workingHoursId" text        NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "WorkingHoursOverride_workingHoursId_fkey"
    FOREIGN KEY ("workingHoursId") REFERENCES "WorkingHours"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "WorkingHoursOverride_workingHoursId_date_key"
    UNIQUE ("workingHoursId", "date")
);
