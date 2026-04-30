/**
 * Phase 5 — Bookings with Pareto popularity, seasonality, and outcome mix.
 *
 * The densest phase of the seed. Generates 1,500 bookings spread across
 * 12 months, each carrying:
 *
 * - **Pareto popularity:** a pre-built `assetAffinity` picks assets with
 *   strong head-bias — top ~20% of the asset pool absorbs ~60% of picks.
 *   R3 (Top Booked Assets) reads off `BOOKING_CHECKED_OUT` groupings to
 *   surface this skew.
 *
 * - **Monthly seasonality:** bookings per month follow `seasonalMultiplier`
 *   — 1.4× in Jun–Jul, 0.7× in Jan–Feb — visible in R9 (Monthly Trends).
 *
 * - **Outcome mix:**
 *     ~80% COMPLETE — full lifecycle (CREATED → RESERVED → ONGOING →
 *                     COMPLETE) with check-out + check-in events per asset.
 *     ~8% CANCELLED — stops somewhere between DRAFT and ONGOING.
 *     ~5% currently ONGOING (incl. ~3% overdue `to < now`) — has check-out
 *                     events, no check-in, status still ONGOING.
 *     ~5% RESERVED (upcoming) — `from > now`, no check-out yet.
 *     ~2% ARCHIVED — full lifecycle + ARCHIVED on top.
 *
 * - **Partial check-ins:** ~5% of COMPLETE bookings route through at least
 *   one `PartialBookingCheckin` row (asset checked in before the booking
 *   as a whole completed). Emits `BOOKING_PARTIAL_CHECKIN` per asset.
 *
 * Asset status fix-up: for bookings that end currently ONGOING, each
 * attached asset's `status` is flipped to `CHECKED_OUT`. Phase 7 handles
 * the complementary `IN_CUSTODY` pass for assets not currently booked.
 */

import { faker } from "@faker-js/faker";

import type { ActivityEventInput } from "../../../app/modules/activity-event/types";
import type { SeederContext, SeederState } from "../context";
import {
  paretoIndex,
  randomDateBetween,
  randomIntInRange,
  seasonalMultiplier,
} from "../distributions";
import { flushEvents } from "../event-flush";
import {
  bookingArchivedEvent,
  bookingAssetAddedEvent,
  bookingCancelledEvent,
  bookingCheckedInEvent,
  bookingCheckedOutEvent,
  bookingCreatedEvent,
  bookingPartialCheckinEvent,
  bookingStatusChangedEvent,
} from "../event-shapes";
import { NAME_SUFFIX } from "../markers";

/** Target total bookings across the 12-month window. */
const TARGET_BOOKINGS = 1_500;

/** Assets per booking, both inclusive. */
const ASSETS_PER_BOOKING_MIN = 1;
const ASSETS_PER_BOOKING_MAX = 8;

/** Fraction of COMPLETE bookings that also produce a partial check-in. */
const PARTIAL_CHECKIN_FRACTION = 0.05;

/** Outcome probabilities. Must sum to 1.0. */
const OUTCOME_WEIGHTS: Readonly<Record<Outcome, number>> = {
  COMPLETE: 0.8,
  CANCELLED: 0.08,
  ONGOING_CURRENT: 0.02,
  ONGOING_OVERDUE: 0.03,
  RESERVED_FUTURE: 0.05,
  ARCHIVED: 0.02,
};

/** Discrete set of booking outcomes this phase can produce. */
type Outcome =
  | "COMPLETE"
  | "CANCELLED"
  | "ONGOING_CURRENT"
  | "ONGOING_OVERDUE"
  | "RESERVED_FUTURE"
  | "ARCHIVED";

/** Final DB status the outcome resolves to. */
const FINAL_STATUS: Readonly<Record<Outcome, string>> = {
  COMPLETE: "COMPLETE",
  CANCELLED: "CANCELLED",
  ONGOING_CURRENT: "ONGOING",
  ONGOING_OVERDUE: "ONGOING",
  RESERVED_FUTURE: "RESERVED",
  ARCHIVED: "ARCHIVED",
};

/**
 * Generate every booking, its asset links, status-transition events, and
 * per-asset check-in/out events. Mutates `state` and accumulates counts.
 */
export async function runBookingsPhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  if (state.assetIds.length === 0) {
    throw new Error(
      "runBookingsPhase: state.assetIds is empty — Phase 3 must run first."
    );
  }

  // Pre-sorted asset pool — Pareto index 0 is "most popular". Sort by a
  // stable hash of the id so the ordering is deterministic across runs
  // rather than dependent on insert-time Prisma ordering.
  const popularityOrder = [...state.assetIds].sort((a, b) =>
    a.localeCompare(b)
  );

  // Distribute bookings across months using `seasonalMultiplier`.
  const monthlyCounts = computeMonthlyCounts(ctx);

  const events: ActivityEventInput[] = [];
  const partialCheckinRows: Array<{
    bookingId: string;
    checkedInById: string;
    assetIds: string[];
    checkinTimestamp: Date;
  }> = [];

  // Track assets that end up currently CHECKED_OUT so we can update their
  // status in one bulk query at the end (avoids N round-trips).
  const checkedOutAssetIds = new Set<string>();

  let bookingsMade = 0;
  for (let m = 0; m < monthlyCounts.length; m++) {
    const monthStart = monthDateBoundary(ctx, m);
    const monthEnd = monthDateBoundary(ctx, m + 1);

    for (let k = 0; k < monthlyCounts[m]; k++) {
      const createdAt = randomDateBetween(monthStart, monthEnd, ctx.rng);
      const outcome = pickOutcome(ctx);

      const booking = await createBooking(ctx, state, {
        popularityOrder,
        createdAt,
        outcome,
        events,
        checkedOutAssetIds,
        partialCheckinRows,
      });
      state.bookingIds.push(booking.id);
      bookingsMade++;
    }
  }

  // Bulk-update assets that ended up currently CHECKED_OUT via an ongoing
  // booking. Single query instead of per-asset updates.
  if (checkedOutAssetIds.size > 0) {
    await ctx.db.asset.updateMany({
      where: { id: { in: [...checkedOutAssetIds] } },
      data: { status: "CHECKED_OUT" },
    });
  }

  // Persist PartialBookingCheckin rows in bulk.
  if (partialCheckinRows.length > 0) {
    await ctx.db.partialBookingCheckin.createMany({
      data: partialCheckinRows.map((r) => ({
        bookingId: r.bookingId,
        checkedInById: r.checkedInById,
        assetIds: r.assetIds,
        checkinCount: r.assetIds.length,
        checkinTimestamp: r.checkinTimestamp,
      })),
    });
  }

  state.counts.bookings = bookingsMade;
  state.counts.partialCheckins = partialCheckinRows.length;
  state.counts.activityEvents += await flushEvents(ctx.db, events);
}

/**
 * Build one booking row + all its events. Mutates `events` /
 * `checkedOutAssetIds` / `partialCheckinRows` as side effects.
 */
async function createBooking(
  ctx: SeederContext,
  state: SeederState,
  args: {
    popularityOrder: string[];
    createdAt: Date;
    outcome: Outcome;
    events: ActivityEventInput[];
    checkedOutAssetIds: Set<string>;
    partialCheckinRows: Array<{
      bookingId: string;
      checkedInById: string;
      assetIds: string[];
      checkinTimestamp: Date;
    }>;
  }
): Promise<{ id: string }> {
  const { popularityOrder, createdAt, outcome, events } = args;
  const creator = ctx.actors.pick(ctx.rng);
  const creatorUserId = creator.userId ?? ctx.ownerUserId;

  // Custodian = whoever the booking is checked out TO. In real Shelf this
  // is set when the booking is created and is required for reports like
  // R5 (Custody Snapshot) to attribute who's holding what. Pick from the
  // actor pool independently of the creator so we get variety.
  const custodian = ctx.actors.pick(ctx.rng);

  const assetCount = randomIntInRange(
    ASSETS_PER_BOOKING_MIN,
    ASSETS_PER_BOOKING_MAX,
    ctx.rng
  );
  const assetIds = pickParetoDistinct(popularityOrder, assetCount, ctx.rng);

  // Derive the from/to window + the status-transition timestamps from the
  // outcome. This is the only place we decide what "currently ONGOING"
  // means vs "completed last month" etc.
  const timeline = buildTimeline(ctx, createdAt, outcome);

  const booking = await ctx.db.booking.create({
    data: {
      name: `${faker.word.adjective()} ${faker.word.noun()} booking${NAME_SUFFIX}`,
      description: faker.company.catchPhrase(),
      creatorId: creatorUserId,
      organizationId: ctx.orgId,
      from: timeline.from,
      to: timeline.to,
      status: FINAL_STATUS[outcome] as
        | "COMPLETE"
        | "CANCELLED"
        | "ONGOING"
        | "RESERVED"
        | "ARCHIVED",
      createdAt,
      // Custodian is always set via TeamMember; userId is set additionally
      // when the picked actor is a real user (matches Shelf's data model
      // where a custodian can be either a registered user or a non-user TM).
      custodianTeamMemberId: custodian.teamMemberId,
      custodianUserId: custodian.userId ?? undefined,
      // Tag the booking so cleanup can identify it. Marker is the first
      // entry in state.tagIds and must be non-null by Phase 2's contract.
      tags: state.markerTagId
        ? { connect: [{ id: state.markerTagId }] }
        : undefined,
      assets: { connect: assetIds.map((id) => ({ id })) },
    },
    select: { id: true },
  });

  // BOOKING_CREATED always fires at the booking's own createdAt.
  events.push(
    bookingCreatedEvent({
      organizationId: ctx.orgId,
      occurredAt: createdAt,
      actor: creator,
      bookingId: booking.id,
    })
  );

  // One BOOKING_ASSETS_ADDED per asset at creation.
  for (const assetId of assetIds) {
    events.push(
      bookingAssetAddedEvent({
        organizationId: ctx.orgId,
        occurredAt: createdAt,
        actor: creator,
        bookingId: booking.id,
        assetId,
      })
    );
  }

  // Walk the status transitions — emit BOOKING_STATUS_CHANGED per step
  // plus semantic events at the relevant transitions.
  for (const step of timeline.transitions) {
    events.push(
      bookingStatusChangedEvent({
        organizationId: ctx.orgId,
        occurredAt: step.at,
        actor: creator,
        bookingId: booking.id,
        fromStatus: step.from,
        toStatus: step.to,
      })
    );

    if (step.to === "ONGOING") {
      for (const assetId of assetIds) {
        events.push(
          bookingCheckedOutEvent({
            organizationId: ctx.orgId,
            occurredAt: step.at,
            actor: creator,
            bookingId: booking.id,
            assetId,
          })
        );
      }
    } else if (step.to === "COMPLETE") {
      for (const assetId of assetIds) {
        events.push(
          bookingCheckedInEvent({
            organizationId: ctx.orgId,
            occurredAt: step.at,
            actor: creator,
            bookingId: booking.id,
            assetId,
          })
        );
      }
    } else if (step.to === "CANCELLED") {
      events.push(
        bookingCancelledEvent({
          organizationId: ctx.orgId,
          occurredAt: step.at,
          actor: creator,
          bookingId: booking.id,
        })
      );
    } else if (step.to === "ARCHIVED") {
      events.push(
        bookingArchivedEvent({
          organizationId: ctx.orgId,
          occurredAt: step.at,
          actor: creator,
          bookingId: booking.id,
        })
      );
    }
  }

  // Partial check-in: a subset of COMPLETE bookings emits a mid-booking
  // partial check-in for 1–2 assets between ONGOING and COMPLETE.
  if (
    outcome === "COMPLETE" &&
    timeline.ongoingAt &&
    timeline.completedAt &&
    ctx.rng() < PARTIAL_CHECKIN_FRACTION
  ) {
    const partialCount = Math.min(
      randomIntInRange(1, 2, ctx.rng),
      assetIds.length
    );
    const partialAssets = assetIds.slice(0, partialCount);
    const partialAt = randomDateBetween(
      timeline.ongoingAt,
      timeline.completedAt,
      ctx.rng
    );

    args.partialCheckinRows.push({
      bookingId: booking.id,
      checkedInById: creatorUserId,
      assetIds: partialAssets,
      checkinTimestamp: partialAt,
    });

    for (const assetId of partialAssets) {
      events.push(
        bookingPartialCheckinEvent({
          organizationId: ctx.orgId,
          occurredAt: partialAt,
          actor: creator,
          bookingId: booking.id,
          assetId,
        })
      );
    }
  }

  // Flag assets that are currently CHECKED_OUT so the bulk update at the
  // end of the phase can set their status correctly.
  if (outcome === "ONGOING_CURRENT" || outcome === "ONGOING_OVERDUE") {
    for (const assetId of assetIds) args.checkedOutAssetIds.add(assetId);
  }

  return booking;
}

/**
 * Decide the from/to window + status-transition timestamps for one
 * booking given its outcome. All dates are backdated relative to `ctx.now`.
 */
function buildTimeline(
  ctx: SeederContext,
  createdAt: Date,
  outcome: Outcome
): {
  from: Date;
  to: Date;
  /** Set for outcomes that reached ONGOING (i.e. assets got checked out). */
  ongoingAt: Date | null;
  /** Set only for outcomes that reached COMPLETE. */
  completedAt: Date | null;
  transitions: Array<{ from: string; to: string; at: Date }>;
} {
  const DAY = 24 * 60 * 60 * 1000;
  const hourAfter = (d: Date, hours: number) =>
    new Date(d.getTime() + hours * 60 * 60 * 1000);
  const daysAfter = (d: Date, days: number) =>
    new Date(d.getTime() + days * DAY);

  switch (outcome) {
    case "COMPLETE": {
      const from = daysAfter(createdAt, randomIntInRange(1, 7, ctx.rng));
      const to = daysAfter(from, randomIntInRange(1, 5, ctx.rng));
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      const ongoingAt = from;
      const completedAt = to;
      return {
        from,
        to,
        ongoingAt,
        completedAt,
        transitions: [
          { from: "DRAFT", to: "RESERVED", at: reservedAt },
          { from: "RESERVED", to: "ONGOING", at: ongoingAt },
          { from: "ONGOING", to: "COMPLETE", at: completedAt },
        ],
      };
    }

    case "ARCHIVED": {
      const from = daysAfter(createdAt, randomIntInRange(1, 7, ctx.rng));
      const to = daysAfter(from, randomIntInRange(1, 5, ctx.rng));
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      const ongoingAt = from;
      const completedAt = to;
      const archivedAt = daysAfter(
        completedAt,
        randomIntInRange(1, 30, ctx.rng)
      );
      return {
        from,
        to,
        ongoingAt,
        completedAt,
        transitions: [
          { from: "DRAFT", to: "RESERVED", at: reservedAt },
          { from: "RESERVED", to: "ONGOING", at: ongoingAt },
          { from: "ONGOING", to: "COMPLETE", at: completedAt },
          { from: "COMPLETE", to: "ARCHIVED", at: archivedAt },
        ],
      };
    }

    case "CANCELLED": {
      const from = daysAfter(createdAt, randomIntInRange(1, 14, ctx.rng));
      const to = daysAfter(from, randomIntInRange(1, 5, ctx.rng));
      // Cancel happens anywhere between create and the booking's `from`.
      const cancelledAt = randomDateBetween(createdAt, from, ctx.rng);
      // ~50% of cancels go DRAFT → CANCELLED, ~50% go DRAFT → RESERVED → CANCELLED.
      if (ctx.rng() < 0.5) {
        return {
          from,
          to,
          ongoingAt: null,
          completedAt: null,
          transitions: [{ from: "DRAFT", to: "CANCELLED", at: cancelledAt }],
        };
      }
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      return {
        from,
        to,
        ongoingAt: null,
        completedAt: null,
        transitions: [
          { from: "DRAFT", to: "RESERVED", at: reservedAt },
          { from: "RESERVED", to: "CANCELLED", at: cancelledAt },
        ],
      };
    }

    case "ONGOING_CURRENT": {
      // Checked out earlier, still inside the booking window. `to` in future.
      const from = daysAfter(ctx.now, -randomIntInRange(1, 5, ctx.rng));
      const to = daysAfter(ctx.now, randomIntInRange(1, 5, ctx.rng));
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      const ongoingAt = from;
      return {
        from,
        to,
        ongoingAt,
        completedAt: null,
        transitions: [
          { from: "DRAFT", to: "RESERVED", at: reservedAt },
          { from: "RESERVED", to: "ONGOING", at: ongoingAt },
        ],
      };
    }

    case "ONGOING_OVERDUE": {
      // Should have been returned already — `to` is in the past.
      const from = daysAfter(ctx.now, -randomIntInRange(7, 30, ctx.rng));
      const to = daysAfter(ctx.now, -randomIntInRange(1, 6, ctx.rng));
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      const ongoingAt = from;
      return {
        from,
        to,
        ongoingAt,
        completedAt: null,
        transitions: [
          { from: "DRAFT", to: "RESERVED", at: reservedAt },
          { from: "RESERVED", to: "ONGOING", at: ongoingAt },
        ],
      };
    }

    case "RESERVED_FUTURE": {
      // Upcoming booking — `from` is in the future, ONGOING hasn't fired yet.
      const from = daysAfter(ctx.now, randomIntInRange(1, 30, ctx.rng));
      const to = daysAfter(from, randomIntInRange(1, 5, ctx.rng));
      const reservedAt = hourAfter(createdAt, randomIntInRange(1, 24, ctx.rng));
      return {
        from,
        to,
        ongoingAt: null,
        completedAt: null,
        transitions: [{ from: "DRAFT", to: "RESERVED", at: reservedAt }],
      };
    }
  }
}

/**
 * Pick `count` DISTINCT assets, biased toward the "head" of the pool via
 * `paretoIndex`. Retries on collisions — for small `count` this is fine.
 */
function pickParetoDistinct(
  pool: readonly string[],
  count: number,
  rng: () => number
): string[] {
  const want = Math.min(count, pool.length);
  const out = new Set<string>();
  let guard = 0;
  while (out.size < want && guard < want * 30) {
    out.add(pool[paretoIndex(pool.length, rng)]);
    guard++;
  }
  // Fill remainder with uniform picks if Pareto kept colliding (rare).
  while (out.size < want) {
    out.add(pool[Math.floor(rng() * pool.length)]);
  }
  return [...out];
}

/** Weighted pick over the `Outcome` enum using `OUTCOME_WEIGHTS`. */
function pickOutcome(ctx: SeederContext): Outcome {
  const outcomes = Object.keys(OUTCOME_WEIGHTS) as Outcome[];
  const weights = outcomes.map((o) => OUTCOME_WEIGHTS[o]);
  const r = ctx.rng();
  let acc = 0;
  for (let i = 0; i < outcomes.length; i++) {
    acc += weights[i];
    if (r < acc) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

/**
 * Split `TARGET_BOOKINGS` across the 12 months using `seasonalMultiplier`
 * so the monthly histogram has a visible peak/trough for R9.
 */
function computeMonthlyCounts(ctx: SeederContext): number[] {
  const months = 12;
  const weights: number[] = [];
  for (let m = 0; m < months; m++) {
    const boundary = monthDateBoundary(ctx, m);
    weights.push(seasonalMultiplier(boundary.getMonth()));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const per = weights.map((w) => Math.round((w / sum) * TARGET_BOOKINGS));
  // Adjust rounding so the total lands exactly on TARGET_BOOKINGS.
  const diff = TARGET_BOOKINGS - per.reduce((a, b) => a + b, 0);
  per[per.length - 1] += diff;
  return per;
}

/** Start of month `m` in the 12-month history window (`m == 12` → `ctx.now`). */
function monthDateBoundary(ctx: SeederContext, m: number): Date {
  const d = new Date(ctx.historyStart);
  d.setMonth(d.getMonth() + m);
  if (m === 12) return new Date(ctx.now);
  return d;
}
