/**
 * "Include assets from child locations" — server side.
 *
 * Turns the ticked `location` values of a request into the set of location ids
 * an asset query should match when the opt-in is on, and answers whether any
 * ticked location has child locations (which decides if the checkbox is
 * offered).
 *
 * Every surface that offers the checkbox must feed the SAME resolved set to
 * each query it builds from the URL — the visible list and any "select all"
 * where-clause alike. Two queries reading the same URL through this resolver
 * cannot disagree about which locations are in scope.
 *
 * @see {@link file://./child-locations-filter.ts}
 * @see {@link file://./descendants.server.ts}
 */
import type { Organization } from "@prisma/client";
import { db } from "~/database/db.server";
import { isIncludingChildLocations } from "./child-locations-filter";
import { getLocationDescendantIds } from "./descendants.server";

/**
 * Filter value meaning "assets placed nowhere". It names a state, not a
 * location, so it has no descendants and passes through untouched.
 */
const WITHOUT_LOCATION = "without-location";

/**
 * The ticked `location` values that name a real location.
 *
 * @param searchParams - The request's search params
 * @returns Every `location` value except the "without location" state
 */
function getTickedLocationIds(searchParams: URLSearchParams): string[] {
  return searchParams
    .getAll("location")
    .filter((value) => value !== WITHOUT_LOCATION);
}

/**
 * Resolves the location ids an asset query should match for this URL.
 *
 * Returns `undefined` when the opt-in is off or no real location is ticked.
 * Callers pass that straight through as "no override", which leaves the query
 * builders on the URL's own `location` values — the exact-match behaviour.
 *
 * When on, the result is the ticked values plus every descendant of each. The
 * ticked values always stay in the set: an id that resolves to nothing (another
 * workspace's location, a deleted one) must keep matching nothing rather than
 * emptying the set, because an empty set reads as "no location filter" and
 * would widen the list to every asset.
 *
 * @param args.organizationId - Scopes the descendant lookup; ids belonging to
 *   another workspace contribute no descendants
 * @param args.searchParams - The request's search params (`location`, plus the
 *   include-child-locations param)
 * @returns The widened id set, or `undefined` to keep the URL's own values
 */
export async function resolveLocationFilterIds({
  organizationId,
  searchParams,
}: {
  organizationId: Organization["id"];
  searchParams: URLSearchParams;
}): Promise<string[] | undefined> {
  if (!isIncludingChildLocations(searchParams)) {
    return undefined;
  }

  const tickedLocationIds = getTickedLocationIds(searchParams);

  if (tickedLocationIds.length === 0) {
    return undefined;
  }

  const descendantIds = await Promise.all(
    tickedLocationIds.map((locationId) =>
      getLocationDescendantIds({ organizationId, locationId })
    )
  );

  return [
    ...new Set([...searchParams.getAll("location"), ...descendantIds.flat()]),
  ];
}

/**
 * Whether any ticked location has at least one child location.
 *
 * Decides if the "Include assets from child locations" checkbox is offered.
 * When it is false, widening the ticked locations would add nothing, so the
 * checkbox could not change the list and is left out.
 *
 * Runs no query when no real location is ticked. The lookup is scoped to the
 * caller's workspace, so an id from another workspace never counts as a parent.
 *
 * @param args.organizationId - The caller's workspace
 * @param args.searchParams - The request's search params (`location` values)
 * @returns `true` when a location in this workspace has a ticked location as
 *   its parent
 */
export async function hasTickedLocationWithChildren({
  organizationId,
  searchParams,
}: {
  organizationId: Organization["id"];
  searchParams: URLSearchParams;
}): Promise<boolean> {
  const tickedLocationIds = getTickedLocationIds(searchParams);

  if (tickedLocationIds.length === 0) {
    return false;
  }

  const childLocation = await db.location.findFirst({
    where: { organizationId, parentId: { in: tickedLocationIds } },
    select: { id: true },
  });

  return childLocation !== null;
}
