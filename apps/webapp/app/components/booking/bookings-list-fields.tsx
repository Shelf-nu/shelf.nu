/**
 * Which bookings list a page shows, and how a bulk dialog posts it.
 *
 * The bookings list with bulk delete, archive and cancel renders on three
 * pages: `/bookings`, a kit's Bookings tab and an asset's Bookings tab. On
 * "Select all" the server resolves the selection itself, from the page's URL
 * params and this list, so it reaches exactly the rows that page's loader
 * counted.
 *
 * The list travels as form fields (or URL params, for the CSV export):
 * `bookingsList` (`index`, `kit` or `asset`) on every page, plus the route
 * param that names it, `kitId` on a kit's tab and `assetId` on an asset's tab.
 * A request without `bookingsList` parses to `null`, and the server refuses its
 * "Select all", since it cannot tell which list the user saw.
 *
 * @see {@link file://./../../routes/api+/bookings.bulk-actions.ts} parses it
 * @see {@link file://./../../modules/booking/service.server.ts} `getBookingsListWhereParams`
 */
import { useParams } from "react-router";
import { z } from "zod";

/**
 * A bookings list: the workspace index, one kit's bookings, or one asset's
 * bookings. A kit's or an asset's list narrows the index, never widens it.
 */
export type BookingsList =
  | { kind: "index" }
  | { kind: "kit"; kitId: string }
  | { kind: "asset"; assetId: string };

/**
 * Parses the list a bulk dialog posts or the export requests. `null` when the
 * request names no list. A kit's list needs its `kitId`, an asset's its
 * `assetId`, and the index neither.
 */
export const BookingsListSchema = z
  .object({
    bookingsList: z.enum(["index", "kit", "asset"]).optional(),
    kitId: z.string().min(1).optional(),
    assetId: z.string().min(1).optional(),
  })
  .refine(({ kitId, assetId }) => !(kitId && assetId), {
    message: "A bookings list belongs to a kit or to an asset, not to both.",
    path: ["assetId"],
  })
  .refine(
    ({ bookingsList, kitId, assetId }) =>
      bookingsList === "kit"
        ? Boolean(kitId)
        : bookingsList === "asset"
        ? Boolean(assetId)
        : !kitId && !assetId,
    {
      message: "The bookings list does not match the kit or asset posted.",
      path: ["bookingsList"],
    }
  )
  .transform(({ bookingsList, kitId, assetId }): BookingsList | null => {
    if (bookingsList === "kit" && kitId) {
      return { kind: "kit", kitId };
    }
    if (bookingsList === "asset" && assetId) {
      return { kind: "asset", assetId };
    }
    if (bookingsList === "index") {
      return { kind: "index" };
    }
    return null;
  });

/**
 * The bookings list the current page shows, read from the route params.
 *
 * @returns The list: a kit's tab, an asset's tab, or the index
 */
export function useBookingsList(): BookingsList {
  const { kitId, assetId } = useParams();

  if (kitId) {
    return { kind: "kit", kitId };
  }
  if (assetId) {
    return { kind: "asset", assetId };
  }
  return { kind: "index" };
}

/**
 * The name/value pairs that name a bookings list, in the shape
 * {@link BookingsListSchema} parses: `bookingsList`, plus `kitId` or `assetId`.
 *
 * @param list - The list to name
 * @returns The pairs to post as form fields or append as URL params
 */
export function bookingsListEntries(list: BookingsList): [string, string][] {
  switch (list.kind) {
    case "index":
      return [["bookingsList", "index"]];
    case "kit":
      return [
        ["bookingsList", "kit"],
        ["kitId", list.kitId],
      ];
    case "asset":
      return [
        ["bookingsList", "asset"],
        ["assetId", list.assetId],
      ];
  }
}

/**
 * Hidden inputs that post the bookings list the current page shows. Render it
 * inside every booking bulk dialog's form.
 */
export function BookingsListFields() {
  const list = useBookingsList();

  return (
    <>
      {bookingsListEntries(list).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
