/**
 * Seed-run markers
 *
 * Constants used to identify rows inserted by the reporting-demo seeder, so
 * the companion cleanup command can drop everything the seeder wrote without
 * touching pre-existing data in the target workspace.
 *
 * - Every `ActivityEvent` the seeder inserts carries `meta.seedRun = SEED_RUN_ID`.
 * - A dedicated `Tag` named `SEED_TAG_NAME` is created in the target org and
 *   attached to every seeded `Asset` and `Booking` via the existing m2m.
 * - Entities that can't carry a tag (TeamMember, Category, Location,
 *   CustomField, Kit, AuditSession) get a `NAME_SUFFIX` appended to their
 *   display name.
 *
 * If the seeder is ever re-shaped, bump `SEED_RUN_ID` (e.g. `v2`). Both the
 * seed and clean commands filter on the current id; v1 rows remain inspectable
 * in place until a v1 clean is run.
 */

/** Marker value written to `ActivityEvent.meta.seedRun` on every seeded event. */
export const SEED_RUN_ID = "reporting-demo-v1" as const;

/** Name of the tag created in the target org and attached to seeded assets/bookings. */
export const SEED_TAG_NAME = "#seed:reporting-demo-v1" as const;

/** Suffix appended to the `name` of entities that cannot carry a tag. */
export const NAME_SUFFIX = " [seed]" as const;

/**
 * Combined meta object to merge into every seeded event's `meta` payload,
 * alongside any action-specific meta (e.g. `{ isExpected: true }`).
 */
export const SEED_META = { seedRun: SEED_RUN_ID } as const;
