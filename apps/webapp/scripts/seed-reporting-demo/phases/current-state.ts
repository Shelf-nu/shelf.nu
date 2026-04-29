/**
 * Phase 7 — Current-state reconciliation (custody).
 *
 * By the time this phase runs, Phase 5 has already:
 * - Flipped ~5% of assets to `CHECKED_OUT` (those in a currently-ONGOING
 *   booking), emitting `BOOKING_CHECKED_OUT` events at the appropriate
 *   past timestamps.
 *
 * This phase adds custody on top:
 * - Picks ~10% of currently-AVAILABLE assets and assigns custody to a
 *   TeamMember. Each gets a `Custody` row (unique per asset), its
 *   `status` flipped to `IN_CUSTODY`, and a backdated `CUSTODY_ASSIGNED`
 *   event at the custody's creation timestamp (so R5 Custody Snapshot
 *   and R8 Asset Utilization both have history to read).
 *
 * - Emits historical `CUSTODY_ASSIGNED` + `CUSTODY_RELEASED` pairs for
 *   another ~25% of assets — these assets are AVAILABLE now (no Custody
 *   row), but carried custody at some point in the window. Adds
 *   interval data for the custody-duration report helper.
 *
 * Idle-asset fraction for R4 is satisfied naturally by the Pareto
 * booking distribution + the assets that end up neither booked nor in
 * custody — no explicit selection needed.
 */

import type { ActivityEventInput } from "../../../app/modules/activity-event/types";
import type { SeederContext, SeederState } from "../context";
import { randomDateBetween, randomIntInRange } from "../distributions";
import { flushEvents } from "../event-flush";
import { custodyAssignedEvent, custodyReleasedEvent } from "../event-shapes";

/** Fraction of currently-AVAILABLE assets that will end in custody. */
const CURRENT_CUSTODY_FRACTION = 0.1;

/** Fraction of currently-AVAILABLE assets that get historical custody pairs. */
const HISTORIC_CUSTODY_FRACTION = 0.25;

/** Historical custody pairs per chosen asset, both inclusive. */
const HISTORIC_PAIRS_MIN = 1;
const HISTORIC_PAIRS_MAX = 2;

/**
 * Perform the reconciliation. Mutates `state.counts` and issues two bulk
 * DB operations (custody createMany + asset status update).
 */
export async function runCurrentStatePhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  if (state.assetIds.length === 0) return;

  // Only touch assets that are currently AVAILABLE — the Phase-5 checked-
  // out subset already has its own current-state story.
  const availableAssets = await ctx.db.asset.findMany({
    where: {
      organizationId: ctx.orgId,
      id: { in: state.assetIds },
      status: "AVAILABLE",
    },
    select: { id: true },
  });
  const availableIds = availableAssets.map((a) => a.id);

  // Partition the available pool into three disjoint buckets.
  const shuffled = [...availableIds].sort(() => ctx.rng() - 0.5);
  const currentCount = Math.round(
    availableIds.length * CURRENT_CUSTODY_FRACTION
  );
  const historicCount = Math.round(
    availableIds.length * HISTORIC_CUSTODY_FRACTION
  );
  const currentBucket = shuffled.slice(0, currentCount);
  const historicBucket = shuffled.slice(
    currentCount,
    currentCount + historicCount
  );

  const events: ActivityEventInput[] = [];

  // --- Current custody ---
  await applyCurrentCustody(ctx, state, currentBucket, events);

  // --- Historic custody pairs ---
  for (const assetId of historicBucket) {
    const pairs = randomIntInRange(
      HISTORIC_PAIRS_MIN,
      HISTORIC_PAIRS_MAX,
      ctx.rng
    );
    for (let i = 0; i < pairs; i++) {
      const custodian = pickTeamMember(ctx);
      const assignedAt = randomDateBetween(
        ctx.historyStart,
        new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000),
        ctx.rng
      );
      const releasedAt = randomDateBetween(
        assignedAt,
        new Date(
          assignedAt.getTime() +
            randomIntInRange(1, 30, ctx.rng) * 24 * 60 * 60 * 1000
        ),
        ctx.rng
      );
      events.push(
        custodyAssignedEvent({
          organizationId: ctx.orgId,
          occurredAt: assignedAt,
          actor: custodian.actor,
          assetId,
          teamMemberId: custodian.teamMemberId,
          targetUserId: custodian.targetUserId,
        })
      );
      events.push(
        custodyReleasedEvent({
          organizationId: ctx.orgId,
          occurredAt: releasedAt,
          actor: custodian.actor,
          assetId,
          teamMemberId: custodian.teamMemberId,
          targetUserId: custodian.targetUserId,
        })
      );
    }
  }

  state.counts.activityEvents += await flushEvents(ctx.db, events);
}

/**
 * Create Custody rows, flip asset status, emit the CUSTODY_ASSIGNED events
 * for the "currently in custody" bucket. Each asset gets exactly one
 * active Custody row (unique FK enforces this).
 */
async function applyCurrentCustody(
  ctx: SeederContext,
  state: SeederState,
  assetIds: string[],
  events: ActivityEventInput[]
): Promise<void> {
  if (assetIds.length === 0) return;

  const custodyRows: Array<{
    assetId: string;
    teamMemberId: string;
    createdAt: Date;
  }> = [];

  // Pick a custodian for each asset. `assignedAt` is spread across the
  // last 6 months so the custody "duration" spans a variety of lengths.
  const sixMonthsAgo = new Date(
    ctx.now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000
  );

  for (const assetId of assetIds) {
    const custodian = pickTeamMember(ctx);
    const assignedAt = randomDateBetween(sixMonthsAgo, ctx.now, ctx.rng);

    custodyRows.push({
      assetId,
      teamMemberId: custodian.teamMemberId,
      createdAt: assignedAt,
    });

    events.push(
      custodyAssignedEvent({
        organizationId: ctx.orgId,
        occurredAt: assignedAt,
        actor: custodian.actor,
        assetId,
        teamMemberId: custodian.teamMemberId,
        targetUserId: custodian.targetUserId,
      })
    );
  }

  await ctx.db.custody.createMany({ data: custodyRows });
  await ctx.db.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { status: "IN_CUSTODY" },
  });

  state.counts.custodies += custodyRows.length;
}

/**
 * Pick a random TeamMember + the corresponding actor. Used for custody
 * assignments — custodians are always TeamMembers; actors are whoever
 * performed the mutation (usually the same person, but the ActorPool
 * distribution already balances this).
 */
function pickTeamMember(ctx: SeederContext): {
  teamMemberId: string;
  actor: ReturnType<typeof ctx.actors.pick>;
  targetUserId?: string;
} {
  const actor = ctx.actors.pick(ctx.rng);
  return {
    teamMemberId: actor.teamMemberId,
    actor,
    targetUserId: actor.userId ?? undefined,
  };
}
