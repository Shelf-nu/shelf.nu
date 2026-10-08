/**
 * Prisma <-> `@shelf/permissions` booking status parity guard.
 *
 * `@shelf/permissions` re-declares the booking status names as a plain
 * string-literal union instead of importing Prisma's `BookingStatus`. That is
 * deliberate and load-bearing: `@prisma/client` is a value import that pulls
 * a native query engine binary, which Metro cannot bundle for React Native,
 * so the package would stop being consumable by the companion app.
 *
 * The cost of that decision is a hand-maintained duplicate, and this file is
 * what stops it drifting. The two assertions below fail to compile if either
 * side gains, loses, or renames a status, so drift is a typecheck error
 * rather than a runtime surprise. `booking-status.parity.test.ts` covers the
 * same ground at runtime, with a failure message that actually names the
 * offending status, read that one first when this file starts erroring.
 *
 * Nothing imports this module; it exists to be typechecked.
 *
 * @see {@link file://../../../../../packages/permissions/src/policies.ts}
 * @see {@link file://./booking-status.parity.test.ts}
 */
import type { BookingStatus } from "@prisma/client";
import type { BookingStatusName } from "@shelf/permissions";

/** Fails when Prisma has a booking status the package is missing. */
type AssertStatusesCoverPrisma = BookingStatus extends BookingStatusName
  ? true
  : never;

/** Fails when the package has a booking status Prisma is missing. */
type AssertPrismaCoversStatuses = BookingStatusName extends BookingStatus
  ? true
  : never;

// why: consts (not just types) so the assertions can't be tree-shaken out of
// typechecking by an unused-type lint fix. `void` keeps no-unused-vars happy.
const _statusesCoverPrisma: AssertStatusesCoverPrisma = true;
const _prismaCoversStatuses: AssertPrismaCoversStatuses = true;
void _statusesCoverPrisma;
void _prismaCoversStatuses;
