/**
 * Shared constant for refusing a custodian filter.
 *
 * Lives in a leaf module rather than beside the narrowing helpers because the
 * where-builders (`getAssetsWhereInput`, `getKitsWhereInput`) need it too, and
 * importing the team-member service into them would couple a pure query-shape
 * helper to a module that pulls in the database client.
 *
 * @see {@link file://./../modules/team-member/service.server.ts} — `scopeCustodianFilterIds`, which produces it
 */

/**
 * Stand-in id used when a custodian filter is refused.
 *
 * Substituted for the requested ids when scoping removes all of them, so the
 * query matches nothing instead of the filter being dropped — an empty list
 * already means "no filter requested" to every where-builder, which would widen
 * the query to every row rather than narrowing it to none.
 *
 * Contains characters a cuid never does, so it can never collide with a real
 * `TeamMember.id` or `User.id`.
 */
export const CUSTODY_FILTER_REFUSED = "__custody-filter-refused__";
