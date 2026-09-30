/**
 * "Include assets from child locations" — the URL contract.
 *
 * A Locations filter matches the exact locations a user ticks. This param is
 * the explicit opt-in that widens each ticked location to itself plus every
 * location nested under it. It is a modifier of the `location` param and means
 * nothing on its own.
 *
 * Shared by the checkbox that writes the param and the server resolver that
 * reads it, so the two cannot disagree on its name or on what counts as "on".
 *
 * @see {@link file://./child-locations-filter.server.ts}
 * @see {@link file://./../../components/booking/include-child-locations-checkbox.tsx}
 */

/** URL param the checkbox writes. Absent means off. */
export const INCLUDE_CHILD_LOCATIONS_PARAM = "includeChildLocations";

/** The only value that reads as on; anything else is off. */
export const INCLUDE_CHILD_LOCATIONS_ON = "true";

/**
 * Whether the URL asks for ticked locations to include their child locations.
 *
 * @param searchParams - The request's (or the page's) search params
 * @returns `true` only for the exact on-value, so a stray or empty param is off
 */
export function isIncludingChildLocations(
  searchParams: URLSearchParams
): boolean {
  return (
    searchParams.get(INCLUDE_CHILD_LOCATIONS_PARAM) ===
    INCLUDE_CHILD_LOCATIONS_ON
  );
}
