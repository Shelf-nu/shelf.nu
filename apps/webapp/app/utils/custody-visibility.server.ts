/**
 * Server-side custody redaction for list payloads.
 *
 * `selfServiceCanSeeCustody` / `baseUserCanSeeCustody` decide whether a
 * restricted role may see WHO holds an asset or kit. That rule was enforced
 * only in `TeamMemberBadge`, a client-side render check — so the badge printed
 * "private" while the loader had already shipped the custodian's name and
 * `user.email` in the payload. Reading the network response was enough to
 * bypass it.
 *
 * This is the server-side half. `assetIndexFields` / `KITS_INCLUDE_FIELDS`
 * select the custodian unconditionally (they have no role argument, and a
 * Prisma `select` cannot vary per row), so the identity is removed here, after
 * the query and before the payload leaves the loader.
 *
 * Deliberately NOT a "drop the custody relation" — see
 * `.claude/rules/permission-gated-loader-data-must-not-gate-display.md`. The
 * row has to survive so the badge can still render "private"; dropping it
 * would turn a meaningful chip into a blank cell and hide the fact that the
 * item is held at all.
 *
 * @see {@link file://./permissions/custody-and-bookings-permissions.validator.client.ts} — `userCanViewSpecificCustody`, the client-side mirror.
 * @see {@link file://../modules/asset/advanced-index/hydrate-heavy.server.ts} — the
 *   advanced index's custody/bookings batches, which apply {@link viewerMaySeeCustodian}
 *   and {@link REDACTED_CUSTODIAN} to their own row shapes via {@link redactBookingsForViewer}.
 */
import type {
  BookingLite,
  ViewerScope,
} from "~/modules/asset/advanced-index/types";

/** The identity fields a list include selects for a custodian. */
type CustodianIdentity = {
  userId?: string | null;
  name?: string | null;
  user?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    profilePicture?: string | null;
    email?: string | null;
  } | null;
} | null;

/** One custody record — the thing that names a custodian. */
type CustodyEntry = { custodian?: CustodianIdentity };

/**
 * A list row carrying an optional custody relation.
 *
 * The relation has TWO shapes and both must be handled: a kit has a single
 * custody row, while an asset has an ARRAY of them, because a
 * quantity-tracked asset can be split across several custodians at once
 * (`Custody.quantity`). Handling only the object form silently misses every
 * asset — the array is not falsy, so it slips through untouched.
 *
 * Deliberately loose otherwise: an intersection with `Record<string, unknown>`
 * here defeats inference, collapsing `T` to this constraint and stripping
 * every loader consumer of its real row type.
 */
export type RowWithCustody = {
  custody?: CustodyEntry | CustodyEntry[] | null;
};

/**
 * The SECOND path to the same identity, walked at runtime rather than declared
 * on {@link RowWithCustody}.
 *
 * A CHECKED_OUT item has no `Custody` row — its holder is the custodian of the
 * ONGOING/OVERDUE booking. `assetIndexFields()` selects that inline, and
 * `updateAssetsWithBookingCustodians` copies it into `custody.custodian` for
 * the chip, so redacting only `custody` emptied the COPY while the source rode
 * along untouched in the same payload.
 *
 * It is deliberately NOT part of the public constraint: adding a field there
 * makes every call site fail to infer `T`, which collapses to the constraint
 * and strips loader consumers of their real row types (the same trap the
 * `Record<string, unknown>` note above describes). The rows are probed
 * structurally instead.
 */
type BookingCustodianCarrier = {
  booking?: {
    custodianUserId?: string | null;
    custodianTeamMemberId?: string | null;
    custodianTeamMember?: CustodianIdentity;
    custodianUser?: { id?: string | null } | null;
  } | null;
};

/**
 * What a redacted custodian looks like on the wire.
 *
 * Every identifying field is emptied rather than removed, so the shape stays
 * stable for consumers and `TeamMemberBadge` still receives a truthy custodian
 * to render its "private" chip from. Exported so every redaction in this file,
 * and the advanced-index heavy hydration batches ({@link redactBookingsForViewer}
 * and the custody batch), blank a custodian to the exact same values.
 */
export const REDACTED_CUSTODIAN = {
  userId: null,
  name: "",
  user: null,
} as const;

/**
 * Whether `userId` may see a given custodian's identity: they hold it
 * themselves. A custodian with no linked `User` (an NRM) can never match, so
 * it is always redacted for a restricted viewer.
 *
 * Callers first check the workspace's `canSeeAllCustody` override — this
 * function only decides the per-entry "is this the viewer's own" exception,
 * it does not know about that override itself.
 *
 * @param custodian - The custodian identity to test, or absent when the row
 *   (or slice) has none.
 * @param userId - The viewer.
 */
export function viewerMaySeeCustodian(
  custodian: CustodianIdentity,
  userId: string
): boolean {
  return (
    !!userId &&
    !!custodian &&
    (custodian.userId === userId || custodian.user?.id === userId)
  );
}

/**
 * Removes custodian identities the viewer is not allowed to see.
 *
 * Mirrors `userCanViewSpecificCustody`: a viewer always sees custody they hold
 * themselves, and sees everyone else's only when the workspace override is on.
 *
 * @param rows - List rows straight from Prisma.
 * @param args.canSeeAllCustody - Resolved by `resolveCanSeeAllCustody`.
 * @param args.userId - The viewer.
 * @returns A shallow copy with disallowed custodian identities emptied. The
 *   input array and its rows are left untouched, because callers reuse them.
 */
export function redactCustodianForViewer<T extends RowWithCustody>(
  rows: T[],
  { canSeeAllCustody, userId }: { canSeeAllCustody: boolean; userId: string }
): T[] {
  if (canSeeAllCustody) {
    return rows;
  }

  /**
   * The viewer's own custody stays visible — redacting it would print
   * "private" on an item they are holding.
   */
  const maySee = (custodian: CustodianIdentity) =>
    viewerMaySeeCustodian(custodian, userId);

  /** Empties one custody record's custodian, or returns it untouched. */
  const redactEntry = (entry: CustodyEntry) =>
    !entry?.custodian || maySee(entry.custodian)
      ? entry
      : { ...entry, custodian: { ...REDACTED_CUSTODIAN } };

  // Casts: only `custody[].custodian` is replaced, so each row keeps its
  // shape. TypeScript cannot verify a spread still satisfies `T`, and widening
  // the signature instead erases the caller's row type — which is exactly what
  // the loader's consumers are typed against.
  /**
   * Whether the viewer is themselves the custodian of this booking — checked
   * across all three shapes the select may provide, since callers differ in
   * which of them they ask for.
   */
  const ownsBooking = (
    booking: NonNullable<BookingCustodianCarrier["booking"]>
  ) =>
    !!userId &&
    (booking.custodianUserId === userId ||
      booking.custodianTeamMember?.userId === userId ||
      booking.custodianUser?.id === userId);

  /** Empties the booking-derived custodian on one `bookingAssets` entry. */
  const redactBookingAsset = (entry: BookingCustodianCarrier) => {
    if (!entry?.booking || ownsBooking(entry.booking)) {
      return entry;
    }

    return {
      ...entry,
      booking: {
        ...entry.booking,
        custodianTeamMember: entry.booking.custodianTeamMember
          ? { ...REDACTED_CUSTODIAN }
          : entry.booking.custodianTeamMember,
        custodianUser: entry.booking.custodianUser ? null : undefined,
        /**
         * The scalar FKs are identity too, and the spread above preserved them.
         * An opaque uuid still links rows to a single holder ("these seven kits
         * are held by the same person, and it isn't me"), and
         * `ORGANIZATION_SELECT_FIELDS` ships `owner: { id, email }` to every
         * role through the `_layout` loader — so it resolves outright whenever
         * the holder is the workspace owner.
         *
         * `kits._index` is the one loader selecting `custodianUserId` today;
         * `custodianTeamMemberId` is cleared on the same principle so it cannot
         * become the next instance the moment someone selects it.
         *
         * Absent stays absent: writing `null` onto a field the caller never
         * selected would invent one.
         */
        ...(entry.booking.custodianUserId === undefined
          ? {}
          : { custodianUserId: null }),
        ...(entry.booking.custodianTeamMemberId === undefined
          ? {}
          : { custodianTeamMemberId: null }),
      },
    };
  };

  return rows.map((row) => {
    // Structural probe — see `BookingCustodianCarrier` for why this is not on
    // the public type.
    const rawBookingAssets = (row as { bookingAssets?: unknown }).bookingAssets;
    const bookingAssets = Array.isArray(rawBookingAssets)
      ? (rawBookingAssets as BookingCustodianCarrier[]).map(redactBookingAsset)
      : rawBookingAssets;

    /**
     * The kits index nests the same booking custodians one level deeper —
     * `assetKits[].asset.bookingAssets` — because a kit's holder is derived
     * from its member assets' bookings. A top-level probe alone misses every
     * one of them.
     */
    const rawAssetKits = (row as { assetKits?: unknown }).assetKits;
    const assetKits = Array.isArray(rawAssetKits)
      ? (
          rawAssetKits as Array<{ asset?: { bookingAssets?: unknown } | null }>
        ).map((ak) => {
          const nested = ak?.asset?.bookingAssets;
          if (!Array.isArray(nested)) {
            return ak;
          }

          return {
            ...ak,
            asset: {
              ...ak.asset,
              bookingAssets: (nested as BookingCustodianCarrier[]).map(
                redactBookingAsset
              ),
            },
          };
        })
      : rawAssetKits;

    const withBookings = {
      ...row,
      ...(rawBookingAssets === undefined ? {} : { bookingAssets }),
      ...(rawAssetKits === undefined ? {} : { assetKits }),
    };

    if (Array.isArray(row.custody)) {
      return {
        ...withBookings,
        custody: row.custody.map(redactEntry),
      } as T;
    }

    if (!row.custody) {
      return withBookings as T;
    }

    return { ...withBookings, custody: redactEntry(row.custody) } as T;
  });
}

/**
 * Removes booking-custodian identities the viewer is not allowed to see from
 * a page of upcoming-bookings entries.
 *
 * Applies the same rule as {@link redactCustodianForViewer} — a restricted
 * viewer sees only the bookings they themselves are the custodian of — to the
 * advanced index's flat, per-`BookingAsset`-slice `BookingLite` shape. That
 * shape has no `bookingAssets`/`assetKits` nesting to walk, so this is a
 * dedicated entry-level pass rather than a call into
 * `redactCustodianForViewer`, but it reuses the same {@link viewerMaySeeCustodian}
 * rule and {@link REDACTED_CUSTODIAN} values so the two redactions can never
 * drift apart. `creator` names who made the booking, not who holds the asset,
 * so it is never redacted. `tags` are workspace metadata, not custody, and are
 * also left untouched.
 *
 * `custodianUser` is nulled outright when redacted (there is no wrapper object
 * to blank a field on); `custodianTeamMember` is kept as an object (its
 * presence signals "a private custodian exists" to the cell) but every
 * identifying field — `name`, `user`, AND the opaque `id` — is cleared, on the
 * same principle as `redactBookingAsset` above: an id still correlates the row
 * to one holder, so it is identity too. `id` becomes `""` (the field is a
 * non-nullable `string`, so the object stays shape-valid).
 *
 * @param bookings - One entry per `BookingAsset` slice, as produced by
 *   `fetchBookingsBatch`.
 * @param scope - The viewer being hydrated for.
 * @returns A new array; entries the viewer may already see are returned
 *   as-is, matching `redactCustodianForViewer`'s contract.
 */
export function redactBookingsForViewer(
  bookings: BookingLite[],
  { canSeeAllCustody, userId }: ViewerScope
): BookingLite[] {
  if (canSeeAllCustody) {
    return bookings;
  }

  return bookings.map((booking) => {
    const isViewersBooking =
      booking.custodianUser?.id === userId ||
      viewerMaySeeCustodian(booking.custodianTeamMember, userId);

    if (isViewersBooking) {
      return booking;
    }

    return {
      ...booking,
      custodianTeamMember: booking.custodianTeamMember
        ? {
            ...booking.custodianTeamMember,
            id: "",
            name: REDACTED_CUSTODIAN.name,
            user: REDACTED_CUSTODIAN.user,
          }
        : booking.custodianTeamMember,
      custodianUser: booking.custodianUser
        ? REDACTED_CUSTODIAN.user
        : booking.custodianUser,
    };
  });
}
