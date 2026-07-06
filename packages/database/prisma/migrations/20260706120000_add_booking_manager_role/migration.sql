-- New organization role for booking-counter operations (issue #1800).
-- Single-statement migration on purpose: a new enum value cannot be USED in
-- the same transaction that adds it, so any future backfill must live in a
-- separate migration file (see 20240718142934/20240718144136 precedent).

-- AlterEnum
ALTER TYPE "OrganizationRoles" ADD VALUE 'BOOKING_MANAGER';
