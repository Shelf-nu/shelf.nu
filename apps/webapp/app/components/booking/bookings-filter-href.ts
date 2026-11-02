/**
 * Links Into The Filtered Bookings Index
 *
 * Builds `/bookings` URLs that open the index already narrowed to one value,
 * for chips and counts that name a set of bookings (a custodian, a tag). The
 * bookings index has a single filter grammar, so no mode lookup is needed.
 *
 * @see {@link file://./../user/team-member-badge.tsx}
 * @see {@link file://./../../routes/_layout+/tags.tsx}
 * @see {@link file://./../assets/assets-filter-link.tsx} the asset index twin
 */

/** Bookings index filters a link can apply. */
export type BookingsFilter = { teamMember: string } | { tag: string };

/**
 * Builds the `/bookings` URL for one filter.
 *
 * @param filter - The filter key and its value, e.g. `{ tag: "<id>" }`
 * @returns A relative URL such as `/bookings?tag=<id>`
 */
export function buildBookingsFilterHref(filter: BookingsFilter): string {
  return `/bookings?${new URLSearchParams(filter)}`;
}
