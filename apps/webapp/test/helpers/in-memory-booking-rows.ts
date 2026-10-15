/**
 * In-memory stand-ins for the booking `updateMany` calls entity transfers emit,
 * so tests replay what Postgres would do to a handful of rows.
 *
 * @see {@link file://../../app/modules/user/service.server.ts} transferEntitiesToNewOwner
 */

/** Shape of the in-memory rows a suite drives the real predicates over. */
export interface FakeBookingRow {
  id: string;
  status: "RESERVED" | "DRAFT";
  organizationId: string;
  creatorId: string | null;
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
}

/**
 * Evaluates a booking `where` against one in-memory row, modelling the subset
 * of Prisma operators `transferEntitiesToNewOwner` actually emits: scalar
 * equality, an `AND` array of sub-clauses, and `{ not: value }` (including
 * `{ not: null }`).
 *
 * The combined `AND: [{ not: null }, { not: id }]` reproduces SQL's
 * `IS NOT NULL AND <> id`: a null value fails the `not: null` branch, so
 * null-custodian rows never match. That is the property that keeps a demoted
 * user's own drafts with them.
 */
export function whereMatches(
  row: FakeBookingRow,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") {
      const clauses = (Array.isArray(value) ? value : [value]) as Record<
        string,
        unknown
      >[];
      return clauses.every((clause) => whereMatches(row, clause));
    }
    if (value !== null && typeof value === "object" && "not" in value) {
      return (
        (row as unknown as Record<string, unknown>)[key] !==
        (value as { not: unknown }).not
      );
    }
    return (row as unknown as Record<string, unknown>)[key] === value;
  });
}

/**
 * Applies a Prisma-style `updateMany({ where, data })` call to an in-memory
 * row array: the minimal stand-in for what Postgres would do. A row only
 * gets `data` merged in when {@link whereMatches}; calls issued for other
 * models (e.g. `Asset.userId`) simply never match a booking row shape.
 */
export function applyUpdateMany(
  rows: FakeBookingRow[],
  call: { where: Record<string, unknown>; data: Record<string, unknown> }
) {
  for (const row of rows) {
    if (whereMatches(row, call.where)) {
      Object.assign(row, call.data);
    }
  }
}
