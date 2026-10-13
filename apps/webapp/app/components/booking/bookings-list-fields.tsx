/**
 * Which bookings list a page shows, and how a bulk dialog posts it.
 *
 * The bookings list with bulk delete, archive and cancel renders on three
 * pages: `/bookings`, a kit's Bookings tab and an asset's Bookings tab. On
 * "Select all" the server resolves the selection itself, from the page's URL
 * params and this list, so it reaches exactly the rows that page's loader
 * counted.
 *
 * The list travels as form fields: `bookingsList` (`index`, `kit` or `asset`)
 * on every page, plus the route param that names it, `kitId` on a kit's tab
 * and `assetId` on an asset's tab. A form without `bookingsList` was loaded
 * before lists were posted; it parses to `null` and the server refuses its
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
 * Parses the list a bulk dialog posts. `null` when the form names no list (a
 * page loaded before lists were posted). A kit's list needs its `kitId`, an
 * asset's its `assetId`, and the index neither.
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
 * Hidden inputs that post the bookings list the current page shows, read from
 * the route params. Render it inside every booking bulk dialog's form.
 */
export function BookingsListFields() {
  const { kitId, assetId } = useParams();

  const bookingsList = kitId ? "kit" : assetId ? "asset" : "index";

  return (
    <>
      <input type="hidden" name="bookingsList" value={bookingsList} />
      {kitId ? <input type="hidden" name="kitId" value={kitId} /> : null}
      {assetId ? <input type="hidden" name="assetId" value={assetId} /> : null}
    </>
  );
}
