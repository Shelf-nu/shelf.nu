/**
 * Which bookings list a page shows, and how a bulk dialog posts it.
 *
 * The bookings list with bulk delete, archive and cancel renders on three
 * pages: `/bookings`, a kit's Bookings tab and an asset's Bookings tab. On
 * "Select all" the server resolves the selection itself, from the page's URL
 * params and this list, so it reaches exactly the rows that page's loader
 * counted.
 *
 * The list travels as form fields named after the route params: `kitId` on a
 * kit's tab, `assetId` on an asset's tab, neither on the index.
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
 * Parses the list a bulk dialog posts. Neither field means the index; both
 * fields is refused, since one list cannot belong to a kit and an asset.
 */
export const BookingsListSchema = z
  .object({
    kitId: z.string().min(1).optional(),
    assetId: z.string().min(1).optional(),
  })
  .refine(({ kitId, assetId }) => !(kitId && assetId), {
    message: "A bookings list belongs to a kit or to an asset, not to both.",
    path: ["assetId"],
  })
  .transform(({ kitId, assetId }): BookingsList => {
    if (kitId) {
      return { kind: "kit", kitId };
    }
    if (assetId) {
      return { kind: "asset", assetId };
    }
    return { kind: "index" };
  });

/**
 * Hidden inputs that post the bookings list the current page shows, read from
 * the route params. Render it inside every booking bulk dialog's form.
 */
export function BookingsListFields() {
  const { kitId, assetId } = useParams();

  return (
    <>
      {kitId ? <input type="hidden" name="kitId" value={kitId} /> : null}
      {assetId ? <input type="hidden" name="assetId" value={assetId} /> : null}
    </>
  );
}
