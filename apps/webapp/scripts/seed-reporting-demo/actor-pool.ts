/**
 * Actor pool for the reporting-demo seeder.
 *
 * An "actor" is whoever the event attributes to — either:
 * - A real `User` with a `UserOrganization` row in the target org (you +
 *   your colleague), or
 * - A fake `TeamMember` without a linked `User` (invented for the seed).
 *
 * Real users drive ~30% of events (so dashboards showing "recent activity by
 * you" render meaningfully); the remaining ~70% are distributed Zipf-style
 * across the 18 fake TeamMembers (a handful are highly active, most are not).
 *
 * Each actor carries a pre-computed `ActorSnapshot` that mirrors what the
 * runtime `recordEvent` would capture, so reports cannot tell seeded events
 * apart from organically written ones.
 */

import { faker } from "@faker-js/faker";

import type { ExtendedPrismaClient } from "@shelf/database";

import { weightedPick, zipfWeights, type RNG } from "./distributions";
import { NAME_SUFFIX } from "./markers";
import type { ActorSnapshot } from "../../app/modules/activity-event/types";

/**
 * A single actor resolvable into `ActivityEvent.actorUserId` / `.teamMemberId`
 * plus the snapshot to persist.
 */
export type Actor = {
  /** Present when the actor is a real User row. */
  userId: string | null;
  /** Present for every actor except system-originated events. */
  teamMemberId: string;
  /** The snapshot written verbatim to `ActivityEvent.actorSnapshot`. */
  snapshot: ActorSnapshot;
};

/** Pool of actors. Use `pick()` per event; weights are Zipf-biased. */
export type ActorPool = {
  /** Real-user actors (owner + optionally one more). */
  real: Actor[];
  /** Fake TeamMember actors with no linked User. */
  fake: Actor[];
  /** Pick a random actor (real + fake combined, Zipf-weighted). */
  pick: (rng: RNG) => Actor;
  /** Lookup by `teamMemberId` for entity `createdBy` attribution. */
  byTeamMemberId: Map<string, Actor>;
};

/**
 * Fraction of events attributed to real users (sum across all real-user
 * actors). Remainder is distributed across fake TeamMembers via Zipf.
 */
const REAL_USER_SHARE = 0.3;

/**
 * How many fake TeamMembers to create. Matches the plan target.
 */
const FAKE_TEAM_MEMBER_COUNT = 18;

/**
 * Resolve the set of real users attached to the target org that the seeder
 * should attribute events to. Picks the OWNER first, and one ADMIN/BASE
 * second if one exists. Returns at most 2 entries.
 *
 * @param db - Prisma client.
 * @param orgId - Target organization id.
 * @returns Array of `{ userId, firstName, lastName, displayName }`.
 */
async function resolveRealUsers(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<
  Array<{
    userId: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  }>
> {
  const rows = await db.userOrganization.findMany({
    where: { organizationId: orgId },
    select: {
      userId: true,
      roles: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
  });

  // Prefer OWNER first, then any ADMIN, then anyone else.
  const ranked = rows
    .map((r) => {
      const roles = r.roles ?? [];
      let priority = 2;
      if (roles.includes("OWNER")) priority = 0;
      else if (roles.includes("ADMIN")) priority = 1;
      return { priority, row: r };
    })
    .sort((a, b) => a.priority - b.priority)
    .map(({ row }) => row);

  const picked = ranked.slice(0, 2).filter((r) => r.user);

  return picked.map((r) => ({
    userId: r.user!.id,
    firstName: r.user!.firstName,
    lastName: r.user!.lastName,
    displayName: r.user!.displayName,
  }));
}

/**
 * For each real user, find or create a TeamMember row in the target org
 * that mirrors them. Shelf creates these rows automatically when a user
 * joins an org — we look up the existing row rather than duplicate it.
 *
 * @param db - Prisma client.
 * @param orgId - Target organization id.
 * @param userIds - Real-user ids to link.
 * @returns `Map<userId, teamMemberId>` for the callers to use when building actors.
 */
async function resolveTeamMembersForRealUsers(
  db: ExtendedPrismaClient,
  orgId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const tms = await db.teamMember.findMany({
    where: { organizationId: orgId, userId: { in: userIds } },
    select: { id: true, userId: true },
  });

  const result = new Map<string, string>();
  for (const tm of tms) {
    if (tm.userId) result.set(tm.userId, tm.id);
  }
  return result;
}

/**
 * Insert `FAKE_TEAM_MEMBER_COUNT` TeamMember rows with faker-generated
 * names, no linked `User`, and the `[seed]` suffix. Returns the created
 * actors (user id stays `null`).
 *
 * The actors' `userId` is intentionally `null` — attribution for their
 * events goes through `teamMemberId` only. Events look like "TeamMember
 * X did Y" rather than implying a real login.
 */
async function createFakeTeamMembers(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<Actor[]> {
  const rows = Array.from({ length: FAKE_TEAM_MEMBER_COUNT }, () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    // Append `[seed]` so human inspectors can immediately spot fakes.
    const name = `${firstName} ${lastName}${NAME_SUFFIX}`;
    return { firstName, lastName, name };
  });

  const created = await Promise.all(
    rows.map((r) =>
      db.teamMember.create({
        data: { name: r.name, organizationId: orgId },
        select: { id: true },
      })
    )
  );

  return created.map((tm, i) => ({
    userId: null,
    teamMemberId: tm.id,
    snapshot: {
      firstName: rows[i].firstName,
      lastName: rows[i].lastName,
      displayName: rows[i].name,
    },
  }));
}

/**
 * Build the full actor pool: resolve real users, find their existing
 * TeamMember rows, mint 18 fake TeamMembers, and compose a weighted
 * `pick()` closure the generators call per event.
 *
 * The weighted selection splits into two bands:
 * 1. Real-user band — flat distribution over however many real users exist
 *    (usually 1–2), scaled to `REAL_USER_SHARE` of the total draw.
 * 2. Fake-TeamMember band — Zipf weights (actor #1 used ~2× actor #10),
 *    scaled to `1 - REAL_USER_SHARE` of the total draw.
 *
 * @param db - Prisma client.
 * @param orgId - Target organization id.
 * @returns A populated `ActorPool`.
 * @throws If the org has zero real users (cannot attribute `createdBy`).
 */
export async function buildActorPool(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<ActorPool> {
  const realRows = await resolveRealUsers(db, orgId);
  if (realRows.length === 0) {
    throw new Error(
      `Organization ${orgId} has no users attached via UserOrganization. ` +
        "At least one real user must exist so that source-entity FK columns " +
        "(Asset.userId, Category.userId, etc.) can be populated."
    );
  }

  const realUserIds = realRows.map((r) => r.userId);
  const tmByUserId = await resolveTeamMembersForRealUsers(
    db,
    orgId,
    realUserIds
  );

  const real: Actor[] = realRows.map((r) => {
    const teamMemberId = tmByUserId.get(r.userId);
    if (!teamMemberId) {
      throw new Error(
        `Real user ${r.userId} is in org ${orgId} but has no matching ` +
          "TeamMember row. Shelf normally creates one on join — something is off."
      );
    }
    return {
      userId: r.userId,
      teamMemberId,
      snapshot: {
        firstName: r.firstName,
        lastName: r.lastName,
        displayName: r.displayName,
      },
    };
  });

  const fake = await createFakeTeamMembers(db, orgId);

  // Pre-compute combined weights: real users get REAL_USER_SHARE total,
  // fakes share the rest via Zipf. Pick() does one weightedPick across
  // the concatenated [real, fake] array.
  const realWeightsRaw = real.map(() => REAL_USER_SHARE / real.length);
  const fakeZipf = zipfWeights(fake.length); // sums to 1
  const fakeWeightsScaled = fakeZipf.map((w) => w * (1 - REAL_USER_SHARE));
  const combined = [...realWeightsRaw, ...fakeWeightsScaled];

  const allActors = [...real, ...fake];
  const byTeamMemberId = new Map<string, Actor>();
  for (const a of allActors) byTeamMemberId.set(a.teamMemberId, a);

  return {
    real,
    fake,
    pick: (rng) => allActors[weightedPick(combined, rng)],
    byTeamMemberId,
  };
}
