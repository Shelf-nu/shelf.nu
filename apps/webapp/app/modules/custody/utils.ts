/**
 * Custody Utilities
 *
 * Helper functions for working with the Custody model.
 * After Phase 2, Asset.custody changed from Custody? (one-to-one) to
 * Custody[] (one-to-many) to support multiple custodians for
 * quantity-tracked assets. These helpers ease the transition.
 */

/**
 * Returns the primary (first) custody record from a custody array.
 * For INDIVIDUAL assets, there is at most one custody record.
 * For QUANTITY_TRACKED assets, returns the first of potentially many.
 *
 * The generic constraint accepts any object type (including partial Custody
 * records from Prisma selects or raw SQL results that may lack `id`).
 *
 * @param custody - Array of custody records from the Asset relation
 * @returns The first custody record, or null if none exist
 */
/**
 * The caller's query decides which row this returns: it takes the FIRST one.
 * A relation fetched without an `orderBy` has no guaranteed order, so a query
 * feeding this helper should order the custody rows — `createdAt` ascending,
 * with `id` to break ties — or the holder shown can change between requests.
 */
export function getPrimaryCustody<T extends Record<string, unknown>>(
  custody: T[] | null | undefined
): T | null {
  if (!custody || custody.length === 0) return null;
  return custody[0] ?? null;
}

/**
 * The user to check the custody card against, for deciding whether the viewer
 * may see it.
 *
 * The card shows direct custody when there is any, and otherwise the booking
 * the item is out on. A booking checkout writes no custody row, so a booking's
 * holder is found on the booking itself, which records it on two links: the
 * team member and the user. Either link makes the viewer the holder — as the
 * server-side redaction and the mobile check treat it — and a booking assigned
 * by picking a team member has no user link at all.
 *
 * Pass the result as `custodianUserId` to `userCanViewSpecificCustody`, which
 * lets a viewer see a holder who is themselves.
 *
 * @param params.custody - The item's custody rows; the first is the primary
 * @param params.booking - The booking the item is out on, if any
 * @param params.viewerUserId - The viewer; when either booking link is theirs,
 *   that link is the one returned
 * @returns The viewer's id when they hold the booking through either link;
 *   otherwise the primary custodian's user, or the booking's team-member link
 *   before its user link (the order the card names the holder in). `undefined`
 *   when the holder has no account or there is no holder.
 */
export function getCustodyCardHolderUserId({
  custody,
  booking,
  viewerUserId,
}: {
  custody:
    | {
        custodian?: {
          userId?: string | null;
          user?: { id?: string } | null;
        } | null;
      }[]
    | null
    | undefined;
  booking?: {
    custodianUser?: { id?: string } | null;
    custodianTeamMember?: { userId?: string | null } | null;
  } | null;
  viewerUserId?: string;
}): string | undefined {
  const primary = getPrimaryCustody(custody);
  if (primary) {
    // Both ids come from the same TeamMember row, so they cannot disagree.
    return (
      primary.custodian?.user?.id ?? primary.custodian?.userId ?? undefined
    );
  }
  const links = [
    booking?.custodianTeamMember?.userId,
    booking?.custodianUser?.id,
  ].filter((id): id is string => Boolean(id));
  return links.find((id) => id === viewerUserId) ?? links[0];
}

/**
 * Checks whether an asset has any active custody records.
 *
 * @param custody - Array of custody records from the Asset relation
 * @returns True if at least one custody record exists
 */
export function hasCustody(
  custody: Record<string, unknown>[] | null | undefined
): boolean {
  return !!custody && custody.length > 0;
}

/**
 * Splits a custody array into the primary custodian (first entry) and
 * any additional custodians, for the multi-custodian rendering used in
 * the advanced asset index. Keeps the column body declarative and
 * avoids inline slicing logic at the call site.
 *
 * @param custody - Array of custody records from the Asset relation
 * @returns `{ primary, others, total }` where `primary` is the first
 *   entry (or null if the array is empty/missing), `others` is every
 *   subsequent entry, and `total` is the full count.
 */
export function formatCustodyList<T extends Record<string, unknown>>(
  custody: T[] | null | undefined
): { primary: T | null; others: T[]; total: number } {
  // Defensive `Array.isArray` against Sentry-observed crashes
  // (SHELF-WEBAPP-1NX, 1NY): a truthy non-array object with a `.length`
  // field bypasses both the `!custody` and `length === 0` guards, then
  // crashes on `custody.slice(1)` with "r.slice is not a function" —
  // breaking the asset list + dashboard row through the error boundary.
  // The TypeScript signature claims `T[] | null | undefined`, but the
  // runtime value can drift (loader code path returning the pre-Phase-2
  // 1:1 shape, hydration mismatch, etc.). Treat anything non-array as
  // empty rather than letting it crash the row.
  if (!custody || !Array.isArray(custody) || custody.length === 0) {
    return { primary: null, others: [], total: 0 };
  }
  return {
    primary: custody[0],
    others: custody.slice(1),
    total: custody.length,
  };
}
