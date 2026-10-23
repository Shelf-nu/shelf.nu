/**
 * Copy helper for the rows of a booking's Assets & Kits list.
 *
 * Lives in its own module because BOTH surfaces that render that list need it:
 * the booking overview (`booking-assets-column.tsx`) and the bookings-index
 * assets drawer (`booking-assets-sidebar.tsx`). Importing one component into
 * the other would drag the overview's whole render tree into the index bundle,
 * and duplicating the phrasing is what let these two surfaces disagree in the
 * first place.
 *
 * @see {@link file://./../components/booking/booking-assets-column.tsx}
 * @see {@link file://./../components/booking/booking-assets-sidebar.tsx}
 */

/** Minimal row shape: only the kit/asset discriminator is needed. */
type BookingRow = { type: string };

/**
 * Describes a page of Assets & Kits rows as what they actually are.
 *
 * A kit occupies ONE row but contains several assets, so a bare row count can
 * never equal the bookings index's asset count. Saying "18 assets and 2 kits"
 * instead of "20 items" makes the difference self-evident: the reader can see
 * the two kits are holding the rest, and each kit row states its own member
 * count.
 *
 * Pass the rows actually being rendered — on page 2 of a paginated booking the
 * caption must describe page 2, not the whole filtered set.
 *
 * @param items - The rows being described.
 * @returns e.g. `"18 assets and 2 kits"`, `"7 assets"`, `"2 kits"`.
 */
export function describeBookingRows(items: BookingRow[]): string {
  const kits = items.filter((item) => item.type === "kit").length;
  const assets = items.length - kits;

  const parts: string[] = [];
  // An all-kits booking should read "2 kits", not "0 assets and 2 kits".
  if (assets > 0 || kits === 0) {
    parts.push(`${assets} ${assets === 1 ? "asset" : "assets"}`);
  }
  if (kits > 0) {
    parts.push(`${kits} ${kits === 1 ? "kit" : "kits"}`);
  }

  return parts.join(" and ");
}
