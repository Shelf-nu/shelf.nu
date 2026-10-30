/**
 * Turning the bookings that block a later end date into something a person
 * can act on: which booking, from when, holding which of the items this
 * booking still has out.
 *
 * Pure: `clash-reservations.server.ts` runs the queries, this file shapes
 * their rows. The shape travels in `ShelfError.additionalData.clashingBookings`
 * to the web dialog and the phone's extend route, and in the booking page's
 * loader as the extend horizon, so it carries no Prisma types.
 *
 * @see {@link file://./clash-reservations.server.ts}
 * @see {@link file://../../components/booking/extend-booking-dialog.tsx}
 */

/** One item a clashing booking shares with the booking being extended. */
export type ClashingBookingItem = {
  /** The asset id, or the kit id for a kit-driven slice. */
  id: string;
  name: string;
  /** A kit is named once, however many of its units sit on both bookings. */
  kind: "asset" | "kit";
};

/** A booking that reserves shared items inside the days being added. */
export type ClashingBooking = {
  id: string;
  name: string;
  /** The instant the clash starts: this booking's start, as an ISO string. */
  from: string;
  items: ClashingBookingItem[];
};

/** A row of the clash query: a booking with the shared slices it holds. */
export type ClashingBookingRow = {
  id: string;
  name: string;
  from?: Date | string | null;
  bookingAssets?:
    | {
        assetId: string;
        assetKitId?: string | null;
        asset?: { title?: string | null } | null;
      }[]
    | null;
};

/** The kit a membership belongs to, for naming kit-driven slices. */
export type KitByMembershipId = ReadonlyMap<
  string,
  { id: string; name: string }
>;

/**
 * Shape the clash rows for the error payload and the extend horizon.
 *
 * Items are deduplicated per booking, kit-driven slices collapse onto their
 * kit, and everything is sorted so the first entry is the one blocking the
 * extension soonest.
 *
 * @param rows - The clashing bookings with the shared slices each one holds
 * @param kitByMembershipId - The kit per `AssetKit.id` the extended booking
 * holds through a kit; a slice whose `assetKitId` is listed here is reported
 * as that kit
 * @returns The bookings, earliest start first, each with its shared items
 * sorted by name
 */
export function describeClashingBookings(
  rows: ClashingBookingRow[],
  kitByMembershipId: KitByMembershipId = new Map()
): ClashingBooking[] {
  const bookings = rows.map((row) => {
    const items = new Map<string, ClashingBookingItem>();
    for (const slice of row.bookingAssets ?? []) {
      const kit = slice.assetKitId
        ? kitByMembershipId.get(slice.assetKitId)
        : undefined;
      const item: ClashingBookingItem = kit
        ? { id: kit.id, name: kit.name, kind: "kit" }
        : {
            id: slice.assetId,
            name: slice.asset?.title?.trim() || "Untitled asset",
            kind: "asset",
          };
      const key = `${item.kind}:${item.id}`;
      if (!items.has(key)) items.set(key, item);
    }
    return {
      id: row.id,
      name: row.name,
      from: toIso(row.from),
      items: [...items.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      ),
    };
  });

  return bookings.sort(
    (a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)
  );
}

/**
 * The instant the first clash starts. The latest end that is still free of
 * named-item clashes lies just before it.
 *
 * @param bookings - The output of {@link describeClashingBookings}
 * @returns The earliest `from` as an ISO string; `undefined` when no booking
 * carries a start
 */
export function earliestClashStart(
  bookings: ClashingBooking[]
): string | undefined {
  return bookings
    .map((b) => b.from)
    .filter(Boolean)
    .sort()[0];
}

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  return "";
}
