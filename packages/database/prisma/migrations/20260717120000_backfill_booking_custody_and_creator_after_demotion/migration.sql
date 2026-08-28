-- Backfill bookings corrupted by role demotion
--
-- Demoting a user (OWNER/ADMIN -> lower rank) ran `transferEntitiesToNewOwner`,
-- a routine written for user *removal*. On the removal path both rewrites are
-- intentional; on the demotion path the user keeps their membership, so both
-- were wrong:
--
--   1. `Booking."custodianUserId"` was nulled while `"custodianTeamMemberId"`
--      still pointed at the (still-present) user. Self-service booking
--      visibility keys solely on `custodianUserId`, so the user's own bookings
--      vanished from their list.
--   2. `Booking."creatorId"` was reassigned to the transfer recipient. DRAFT
--      visibility keys solely on `creatorId`, so the user's drafts vanished for
--      them and became visible to the recipient.
--
-- The code fix restricts both rewrites to `reason = "removal"`. This migration
-- repairs rows already corrupted in the field.
--
-- ORDERING REQUIREMENT: this migration must only take effect once the code fix
-- is serving traffic. `apps/webapp/fly.toml` runs
-- `release_command = "npx prisma migrate deploy"` BEFORE the new version rolls
-- out, so for roughly one to two minutes the old code still serves and a fresh
-- demotion in that window can re-corrupt rows this migration just repaired.
--
-- MITIGATION, PRECISELY: both statements are idempotent (after they run, no row
-- matches their predicate), so the repair can safely be applied again. But
-- `prisma migrate deploy` will NOT re-apply this file — once recorded in
-- `_prisma_migrations` it is skipped forever. Re-applying means an operator
-- executing the two UPDATE statements below MANUALLY against the database.
--
-- So, after the rollout completes: re-run dry-run query (a) from the team's
-- scratch file. If it returns 0, nothing was re-corrupted and there is nothing
-- to do. If it returns non-zero, copy the two statements below and run them by
-- hand. Do not attempt to re-run the migration itself.
--
-- LOCK IMPACT: two `UPDATE ... FROM` over a sub-100k-row table, taking row
-- locks on matched rows only. No table rewrite, no index build.

-- Statement 1 — restore `custodianUserId` from the paired team member.
--
-- The value is RECOVERED, not guessed: the repo enforces the invariant
-- `Booking.custodianUserId == Booking.custodianTeamMember.userId`, so the
-- surviving `custodianTeamMemberId` still names the correct user.
--
-- `tm."userId" IS NOT NULL` skips bookings assigned to a non-registered team
-- member — those legitimately carry a null `custodianUserId` and are not
-- corruption.
--
-- The two EXISTS guards are what separate a demotion from a legitimate
-- *removal* (whose null is intentional and must be preserved):
--
--   * UserOrganization — the user must STILL be a member. Removal deletes this
--     row (`revokeAccessToOrganization`), so every removal self-excludes here.
--     This carries the guard on its own: removal also disconnects
--     `TeamMember.userId`, but only for a single row found via `findFirst`, and
--     `TeamMember` has no unique constraint on `(userId, organizationId)` — so
--     that disconnect is not airtight and is not relied upon. This also excludes
--     SCIM access revocations.
--   * RoleChangeLog — a demotion must actually have happened. This is lossless:
--     `RoleChangeLog` shipped in the same commit as the bug, and its row is
--     written in the same transaction as the corrupting transfer, so no
--     demotion can be missing one. The pairs below mirror `ROLE_RANK`
--     (OWNER 3, ADMIN 2, SELF_SERVICE 1, BASE 1) — SELF_SERVICE <-> BASE is a
--     lateral move, never a demotion, and never triggered a transfer.
--
-- `tm."deletedAt"` is deliberately NOT filtered: if the user still holds a
-- UserOrganization row, restoring the custodian the UI already renders is
-- correct whether or not the TeamMember row is soft-deleted.
UPDATE "Booking" b
SET "custodianUserId" = tm."userId"
FROM "TeamMember" tm
WHERE b."custodianTeamMemberId" = tm."id"
  AND tm."organizationId" = b."organizationId"
  AND b."custodianUserId" IS NULL
  AND tm."userId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "UserOrganization" uo
    WHERE uo."userId" = tm."userId"
      AND uo."organizationId" = b."organizationId"
  )
  AND EXISTS (
    SELECT 1
    FROM "RoleChangeLog" rcl
    WHERE rcl."userId" = tm."userId"
      AND rcl."organizationId" = b."organizationId"
      AND (
        (rcl."previousRole" = 'OWNER' AND rcl."newRole" IN ('ADMIN', 'SELF_SERVICE', 'BASE'))
        OR
        (rcl."previousRole" = 'ADMIN' AND rcl."newRole" IN ('SELF_SERVICE', 'BASE'))
      )
  );

-- Statement 2 — restore `creatorId` from the booking-creation event.
--
-- `ActivityEvent."actorUserId"` equals `Booking."creatorId"` at creation time:
-- a booking is only ever created at two sites, `createBooking` (which emits
-- `BOOKING_CREATED` with `actorUserId: booking.creatorId`) and
-- `duplicateBooking` (which writes `creatorId: userId` and emits with
-- `actorUserId: userId`). `transferEntitiesToNewOwner` is the only writer of
-- `creatorId` after creation, so a mismatch between the event and the column
-- means the transfer ran.
--
-- The same two EXISTS guards as statement 1 apply, here to the recovered
-- creator, so no intentional removal transfer is reverted. It also restores the
-- creator ONLY for bookings the actor still owns (custodian is the actor, or
-- none), matching the runtime scoped transfer — so it does not undo the
-- created-for-others transfer. That custody check reads `custodianUserId`,
-- which statement 1 restores, so THESE TWO STATEMENTS MUST RUN IN THIS ORDER.
--
-- ACCEPTED, UNRECOVERABLE RESIDUE: `ActivityEvent` was introduced by migration
-- `20260421123609`, while the bug landed with `20260217120638`. Bookings created
-- in that window have no `BOOKING_CREATED` event, so their original creator is
-- not recorded anywhere and cannot be restored. Those rows are left untouched.
--
-- `DISTINCT ON` keeps the result deterministic if a booking ever carries more
-- than one creation event; the earliest one is authoritative.
UPDATE "Booking" b
SET "creatorId" = src."actorUserId"
FROM (
  SELECT DISTINCT ON (ae."bookingId")
    ae."bookingId",
    ae."actorUserId",
    ae."organizationId"
  FROM "ActivityEvent" ae
  WHERE ae."action" = 'BOOKING_CREATED'
    AND ae."bookingId" IS NOT NULL
    AND ae."actorUserId" IS NOT NULL
  ORDER BY ae."bookingId", ae."occurredAt" ASC
) src
WHERE src."bookingId" = b."id"
  AND src."organizationId" = b."organizationId"
  AND src."actorUserId" <> b."creatorId"
  -- Only restore the creator on bookings the actor still owns: where they are
  -- the custodian (custody is restored by statement 1 above, which runs first
  -- in this transaction) or the booking has no registered custodian. Bookings
  -- the actor created FOR a different custodian are deliberately left with the
  -- transfer recipient, matching the runtime scoped transfer
  -- (`bookingsReassignedOnDemotionWhere`). Restoring those would re-grant the
  -- demoted user creator-based write access to someone else's booking.
  AND (b."custodianUserId" IS NULL OR b."custodianUserId" = src."actorUserId")
  AND EXISTS (
    SELECT 1
    FROM "UserOrganization" uo
    WHERE uo."userId" = src."actorUserId"
      AND uo."organizationId" = b."organizationId"
  )
  AND EXISTS (
    SELECT 1
    FROM "RoleChangeLog" rcl
    WHERE rcl."userId" = src."actorUserId"
      AND rcl."organizationId" = b."organizationId"
      AND (
        (rcl."previousRole" = 'OWNER' AND rcl."newRole" IN ('ADMIN', 'SELF_SERVICE', 'BASE'))
        OR
        (rcl."previousRole" = 'ADMIN' AND rcl."newRole" IN ('SELF_SERVICE', 'BASE'))
      )
  );
