/**
 * Phase 4 — Kits with asset membership.
 *
 * Creates 15 `Kit` rows, each holding 3–8 assets selected from the pool
 * that Phase 3 built. Shelf models kit membership as a single `Kit.id`
 * column on `Asset` (not a join table), so we `update` each chosen asset
 * to point at its kit.
 *
 * Events per kit:
 * - 1 × `KIT_CREATED`
 * - N × `ASSET_KIT_CHANGED` (one per asset added, `fromValue: null`,
 *   `toValue: kit.id`)
 *
 * Kits exist by early in the history window so assets can be bookable as
 * kits during Phase 5. Kit creators are sampled from the actor pool;
 * `Kit.createdById` is required by the schema so we always attribute to
 * a real user id.
 */

import { faker } from "@faker-js/faker";

import type { ActivityEventInput } from "../../../app/modules/activity-event/types";
import type { SeederContext, SeederState } from "../context";
import { randomDateBetween, randomIntInRange } from "../distributions";
import { flushEvents } from "../event-flush";
import { assetFieldChangedEvent, kitCreatedEvent } from "../event-shapes";
import { NAME_SUFFIX } from "../markers";

/** Target number of kits; matches the medium-scale plan. */
const TARGET_KITS = 15;

/** Members per kit, both inclusive. */
const KIT_MEMBERS_MIN = 3;
const KIT_MEMBERS_MAX = 8;

/** Start-of-kits window — ~45 days after historyStart (after taxonomy + early assets). */
const KIT_CREATE_START_OFFSET_MS = 45 * 24 * 60 * 60 * 1000;

/** End-of-kits window — ~90 days after historyStart (give bookings time to use them). */
const KIT_CREATE_END_OFFSET_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Create the kits + attach assets. Mutates `state.kitIds` and pulls from
 * `state.assetIds` without mutating that list (assets stay reachable for
 * Phase 5 even if they're kit members).
 */
export async function runKitsPhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  if (state.assetIds.length === 0) {
    throw new Error(
      "runKitsPhase: state.assetIds is empty — Phase 3 must run first."
    );
  }

  const createWindow = {
    start: new Date(ctx.historyStart.getTime() + KIT_CREATE_START_OFFSET_MS),
    end: new Date(ctx.historyStart.getTime() + KIT_CREATE_END_OFFSET_MS),
  };

  // Pool of assets available for kit membership. We draw without
  // replacement so no asset ends up in two kits (schema allows only one
  // `kitId` per asset). Remaining assets stay kit-less — typical Shelf usage.
  const assetPool = [...state.assetIds];
  shuffleInPlace(assetPool, ctx.rng);

  const events: ActivityEventInput[] = [];

  for (let i = 0; i < TARGET_KITS; i++) {
    const memberCount = Math.min(
      randomIntInRange(KIT_MEMBERS_MIN, KIT_MEMBERS_MAX, ctx.rng),
      assetPool.length
    );
    if (memberCount === 0) break;

    const createdAt = randomDateBetween(
      createWindow.start,
      createWindow.end,
      ctx.rng
    );
    const creator = ctx.actors.pick(ctx.rng);
    // Kit.createdById requires a real user id. Fall back to the org owner
    // if the picked actor is a fake TeamMember with no linked User.
    const createdById = creator.userId ?? ctx.ownerUserId;

    const memberIds = assetPool.splice(0, memberCount);
    const name = `${faker.commerce.department()} Kit #${i + 1}${NAME_SUFFIX}`;

    const kit = await ctx.db.kit.create({
      data: {
        name,
        description: faker.company.catchPhrase(),
        createdById,
        organizationId: ctx.orgId,
        status: "AVAILABLE",
        createdAt,
        // Create one pivot row per member asset; the unique constraint on
        // `AssetKit.assetId` keeps the 1:1 invariant during seed.
        assetKits: {
          create: memberIds.map((assetId) => ({
            assetId,
            organizationId: ctx.orgId,
          })),
        },
      },
      select: { id: true },
    });
    state.kitIds.push(kit.id);

    // KIT_CREATED — one event per kit at its `createdAt`.
    events.push(
      kitCreatedEvent({
        organizationId: ctx.orgId,
        occurredAt: createdAt,
        actor: creator,
        kitId: kit.id,
      })
    );

    // ASSET_KIT_CHANGED — one event per asset added. Emitted at the same
    // time as the kit creation; attribution is the kit's creator.
    for (const assetId of memberIds) {
      events.push(
        assetFieldChangedEvent({
          organizationId: ctx.orgId,
          occurredAt: createdAt,
          actor: creator,
          assetId,
          action: "ASSET_KIT_CHANGED",
          field: "kit",
          fromValue: null,
          toValue: kit.id,
        })
      );
    }
  }

  state.counts.kits = state.kitIds.length;
  const written = await flushEvents(ctx.db, events);
  state.counts.activityEvents += written;
}

/**
 * In-place Fisher-Yates shuffle using the injected RNG. O(n) with no
 * allocations — called once on the asset pool at phase start.
 */
function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
