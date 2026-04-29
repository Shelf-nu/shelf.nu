/**
 * Phase 3 — Assets with change history.
 *
 * Creates 300 `Asset` rows spread across the 12-month history window,
 * each attached to the seed marker tag + 0–2 random content tags. Every
 * asset produces one `ASSET_CREATED` event at its own `createdAt`.
 *
 * For ~40% of assets, also emits 1–4 `ASSET_*_CHANGED` events over the
 * asset's lifetime (between its `createdAt` and `now`). Field choices
 * chain together so each subsequent event's `fromValue` matches the
 * prior event's `toValue` — giving R7 (Asset Activity Summary) and R8
 * (Asset Utilization) realistic change trails.
 *
 * Phase 3 does NOT cover custody or booking events — those land in
 * phases 5/7. All assets exit this phase with `status = AVAILABLE`.
 */

import { faker } from "@faker-js/faker";

import type { ActivityEventInput } from "../../../app/modules/activity-event/types";
import type { SeederContext, SeederState } from "../context";
import { randomDateBetween, randomIntInRange } from "../distributions";
import { flushEvents } from "../event-flush";
import {
  assetCreatedEvent,
  assetFieldChangedEvent,
  type AssetFieldChangeAction,
} from "../event-shapes";

/** Target number of assets; matches the medium-scale plan. */
const TARGET_ASSETS = 300;

/** Fraction of assets that get a change trail. */
const CHANGE_TRAIL_FRACTION = 0.4;

/** Per-asset change count range (both inclusive). */
const CHANGES_PER_ASSET_MIN = 1;
const CHANGES_PER_ASSET_MAX = 4;

/** Start of the window in which assets can be created (taxonomy setup ends here). */
const ASSET_CREATE_START_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;

/** Assets can't be "created yesterday" — give change trails room to fan out. */
const ASSET_CREATE_END_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create the asset rows + their ASSET_CREATED / ASSET_*_CHANGED events.
 * Mutates `state.assetIds` and `state.counts` in place.
 */
export async function runAssetsPhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  if (!state.markerTagId) {
    throw new Error(
      "runAssetsPhase: state.markerTagId is missing — Phase 2 must run first."
    );
  }

  const createWindow = {
    start: new Date(ctx.historyStart.getTime() + ASSET_CREATE_START_OFFSET_MS),
    end: new Date(ctx.now.getTime() - ASSET_CREATE_END_OFFSET_MS),
  };

  // Content tags = all tags except the marker, for the 0–2 random attachments.
  const contentTagIds = state.tagIds.filter((id) => id !== state.markerTagId);

  const allEvents: ActivityEventInput[] = [];

  for (let i = 0; i < TARGET_ASSETS; i++) {
    const createdAt = randomDateBetween(
      createWindow.start,
      createWindow.end,
      ctx.rng
    );
    const creator = ctx.actors.pick(ctx.rng);

    const categoryId = pickRandom(state.categoryIds, ctx.rng);
    // ~10% of assets have no location so R10 (Distribution by Location)
    // shows an "(unassigned)" bucket.
    const locationId =
      ctx.rng() < 0.1 ? null : pickRandom(state.locationIds, ctx.rng);
    const valuation =
      ctx.rng() < 0.7 ? randomIntInRange(50, 5000, ctx.rng) : null;

    // 0–2 random content tags, no repeats. Marker tag always attached on top.
    const extraTagCount = ctx.rng() < 0.6 ? randomIntInRange(0, 2, ctx.rng) : 0;
    const extraTagIds = sampleWithoutReplacement(
      contentTagIds,
      extraTagCount,
      ctx.rng
    );
    const tagIdsToConnect = [state.markerTagId, ...extraTagIds];

    const initialTitle = faker.commerce.productName();
    const initialDescription = faker.commerce.productDescription();

    const asset = await ctx.db.asset.create({
      data: {
        title: initialTitle,
        description: initialDescription,
        valuation,
        categoryId,
        locationId,
        userId: ctx.ownerUserId,
        organizationId: ctx.orgId,
        status: "AVAILABLE",
        createdAt,
        tags: { connect: tagIdsToConnect.map((id) => ({ id })) },
      },
      select: { id: true },
    });
    state.assetIds.push(asset.id);

    allEvents.push(
      assetCreatedEvent({
        organizationId: ctx.orgId,
        occurredAt: createdAt,
        actor: creator,
        assetId: asset.id,
      })
    );

    if (ctx.rng() < CHANGE_TRAIL_FRACTION) {
      const trail = buildChangeTrail(ctx, state, {
        assetId: asset.id,
        createdAt,
        initialTitle,
        initialDescription,
        initialValuation: valuation,
        initialCategoryId: categoryId,
        initialLocationId: locationId,
      });
      allEvents.push(...trail);
    }
  }

  state.counts.assets = state.assetIds.length;
  const written = await flushEvents(ctx.db, allEvents);
  state.counts.activityEvents += written;
}

/**
 * Build 1–4 `ASSET_*_CHANGED` events for a single asset, chained so each
 * event's `fromValue` matches the previous event's `toValue`. The asset's
 * row in the DB keeps its original values — events are the report-facing
 * history; the asset's "current state" is whatever we wrote at create-time.
 *
 * Supported fields: name, description, valuation, category, location. Kit
 * changes are deferred to Phase 4 (which attaches assets to kits).
 */
function buildChangeTrail(
  ctx: SeederContext,
  state: SeederState,
  seed: {
    assetId: string;
    createdAt: Date;
    initialTitle: string;
    initialDescription: string;
    initialValuation: number | null;
    initialCategoryId: string;
    initialLocationId: string | null;
  }
): ActivityEventInput[] {
  const events: ActivityEventInput[] = [];
  const count = randomIntInRange(
    CHANGES_PER_ASSET_MIN,
    CHANGES_PER_ASSET_MAX,
    ctx.rng
  );

  // Running "current" values so successive events chain. These start at
  // the asset's seed values; each emitted event advances one of them.
  const current = {
    name: seed.initialTitle,
    description: seed.initialDescription,
    valuation: seed.initialValuation,
    categoryId: seed.initialCategoryId,
    locationId: seed.initialLocationId,
  };

  // Spread the `count` changes evenly-ish between createdAt and now.
  const timeline = spreadTimes(seed.createdAt, ctx.now, count, ctx.rng);

  for (let i = 0; i < count; i++) {
    const occurredAt = timeline[i];
    const actor = ctx.actors.pick(ctx.rng);
    const action = pickChangeAction(ctx);

    switch (action) {
      case "ASSET_NAME_CHANGED": {
        const next = faker.commerce.productName();
        events.push(
          assetFieldChangedEvent({
            organizationId: ctx.orgId,
            occurredAt,
            actor,
            assetId: seed.assetId,
            action,
            field: "name",
            fromValue: current.name,
            toValue: next,
          })
        );
        current.name = next;
        break;
      }
      case "ASSET_DESCRIPTION_CHANGED": {
        const next = faker.commerce.productDescription();
        events.push(
          assetFieldChangedEvent({
            organizationId: ctx.orgId,
            occurredAt,
            actor,
            assetId: seed.assetId,
            action,
            field: "description",
            fromValue: current.description,
            toValue: next,
          })
        );
        current.description = next;
        break;
      }
      case "ASSET_VALUATION_CHANGED": {
        const next = randomIntInRange(50, 5000, ctx.rng);
        events.push(
          assetFieldChangedEvent({
            organizationId: ctx.orgId,
            occurredAt,
            actor,
            assetId: seed.assetId,
            action,
            field: "valuation",
            fromValue: current.valuation,
            toValue: next,
          })
        );
        current.valuation = next;
        break;
      }
      case "ASSET_CATEGORY_CHANGED": {
        const next = pickRandom(
          state.categoryIds.filter((id) => id !== current.categoryId),
          ctx.rng
        );
        events.push(
          assetFieldChangedEvent({
            organizationId: ctx.orgId,
            occurredAt,
            actor,
            assetId: seed.assetId,
            action,
            field: "category",
            fromValue: current.categoryId,
            toValue: next,
          })
        );
        current.categoryId = next;
        break;
      }
      case "ASSET_LOCATION_CHANGED": {
        const others = state.locationIds.filter(
          (id) => id !== current.locationId
        );
        const next = others.length ? pickRandom(others, ctx.rng) : null;
        events.push(
          assetFieldChangedEvent({
            organizationId: ctx.orgId,
            occurredAt,
            actor,
            assetId: seed.assetId,
            action,
            field: "location",
            fromValue: current.locationId,
            toValue: next,
          })
        );
        current.locationId = next;
        break;
      }
    }
  }

  return events;
}

/** Pick one of the asset-level `*_CHANGED` actions, skipping `KIT_CHANGED`. */
function pickChangeAction(ctx: SeederContext): AssetFieldChangeAction {
  const pool: AssetFieldChangeAction[] = [
    "ASSET_NAME_CHANGED",
    "ASSET_DESCRIPTION_CHANGED",
    "ASSET_VALUATION_CHANGED",
    "ASSET_CATEGORY_CHANGED",
    "ASSET_LOCATION_CHANGED",
  ];
  return pool[randomIntInRange(0, pool.length - 1, ctx.rng)];
}

/** Uniform pick — throws on empty input so callers don't silently skip. */
function pickRandom<T>(arr: readonly T[], rng: () => number): T {
  if (arr.length === 0) throw new Error("pickRandom: empty array");
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Draw `n` distinct items from `arr` without replacement.
 *
 * Uses a partial Fisher-Yates shuffle — O(n) work, no allocations per
 * swap beyond the output array, handles `n > arr.length` by capping.
 */
function sampleWithoutReplacement<T>(
  arr: readonly T[],
  n: number,
  rng: () => number
): T[] {
  const size = Math.min(n, arr.length);
  if (size === 0) return [];
  const pool = arr.slice();
  const out: T[] = [];
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

/**
 * Produce `count` sorted dates between `start` (exclusive) and `end`
 * (exclusive), roughly evenly spread with jitter.
 *
 * Used for per-asset change trails — each date is the `occurredAt` of
 * one `ASSET_*_CHANGED` event.
 */
function spreadTimes(
  start: Date,
  end: Date,
  count: number,
  rng: () => number
): Date[] {
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    times.push(randomDateBetween(start, end, rng));
  }
  times.sort((a, b) => a.getTime() - b.getTime());
  return times;
}
