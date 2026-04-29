/**
 * Phase 2 — Taxonomy.
 *
 * Creates the supporting reference rows every later phase depends on:
 * 7 `Category`, 5 `Location`, 10 `Tag` (incl. the seed marker tag),
 * 3 `CustomField`.
 *
 * Emits `LOCATION_CREATED` events (the only `*_CREATED` action Shelf's
 * enum tracks for taxonomy — Category / Tag / CustomField creation is
 * not instrumented at runtime, so we match that and skip events for
 * those rows).
 *
 * TeamMember creation + actor-pool construction live in the orchestrator
 * (before this phase runs), so `ctx.actors` is already populated when we
 * pick an owner for the `LOCATION_CREATED` events.
 *
 * All inserted timestamps land in the first ~30 days of the history
 * window so that assets/bookings created later in the timeline have
 * valid parent rows to reference.
 */

import { faker } from "@faker-js/faker";
import type { CustomFieldType } from "@shelf/database";

import type { SeederContext, SeederState } from "../context";
import { randomDateBetween } from "../distributions";
import { flushEvents } from "../event-flush";
import { locationCreatedEvent } from "../event-shapes";
import { NAME_SUFFIX, SEED_TAG_NAME } from "../markers";

/**
 * Curated category names. Seven realistic asset categories that give the
 * R10 "Distribution by Category" report a believable spread.
 */
const CATEGORY_NAMES = [
  "Laptops",
  "Cameras",
  "Audio Equipment",
  "Power Tools",
  "Measuring Instruments",
  "Safety Gear",
  "Office Supplies",
] as const;

/** Seven-colour palette — Shelf categories carry a display colour. */
const CATEGORY_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#6B7280",
] as const;

/** Five realistic location names. */
const LOCATION_NAMES = [
  "Main Warehouse",
  "Branch Office",
  "Workshop",
  "Storage Unit A",
  "Remote Site",
] as const;

/**
 * Nine content tag names plus the marker tag (spliced in at index 0 at
 * insert time). Covers asset + booking tag scopes.
 */
const TAG_NAMES = [
  "fragile",
  "high-value",
  "outdoor",
  "training",
  "rental",
  "archived",
  "maintenance-due",
  "certified",
  "internal-use",
] as const;

/**
 * Three custom fields covering the common Shelf types so the reporting UI
 * can render text, date, and number filters.
 */
const CUSTOM_FIELDS: ReadonlyArray<{ name: string; type: CustomFieldType }> = [
  { name: "Serial Number", type: "TEXT" },
  { name: "Purchase Date", type: "DATE" },
  { name: "Warranty Months", type: "NUMBER" },
] as const;

/**
 * Insert taxonomy rows. Mutates `state` with the new ids and bumps counts.
 * Returns nothing — all results are in `state`.
 *
 * Pre-conditions: `ctx.actors` is already built (actor pool lives in the
 * orchestrator's setup, before phases run).
 *
 * @param ctx - Read-only seeder context (db, org, rng, actors, etc.).
 * @param state - Accumulator mutated in place.
 */
export async function runTaxonomyPhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  // Spread taxonomy creation across first 30 days of history so every asset
  // / booking created later has a parent row that already exists at that
  // point in the timeline.
  const setupEnd = new Date(
    ctx.historyStart.getTime() + 30 * 24 * 60 * 60 * 1000
  );

  await insertCategories(ctx, state, setupEnd);
  await insertLocations(ctx, state, setupEnd);
  await insertTags(ctx, state, setupEnd);
  await insertCustomFields(ctx, state, setupEnd);
}

async function insertCategories(
  ctx: SeederContext,
  state: SeederState,
  end: Date
): Promise<void> {
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    const createdAt = randomDateBetween(ctx.historyStart, end, ctx.rng);
    const row = await ctx.db.category.create({
      data: {
        name: `${CATEGORY_NAMES[i]}${NAME_SUFFIX}`,
        color: CATEGORY_COLORS[i],
        userId: ctx.ownerUserId,
        organizationId: ctx.orgId,
        createdAt,
      },
      select: { id: true },
    });
    state.categoryIds.push(row.id);
  }
  state.counts.categories = state.categoryIds.length;
}

async function insertLocations(
  ctx: SeederContext,
  state: SeederState,
  end: Date
): Promise<void> {
  for (let i = 0; i < LOCATION_NAMES.length; i++) {
    const createdAt = randomDateBetween(ctx.historyStart, end, ctx.rng);
    const row = await ctx.db.location.create({
      data: {
        name: `${LOCATION_NAMES[i]}${NAME_SUFFIX}`,
        description: faker.company.catchPhrase(),
        userId: ctx.ownerUserId,
        organizationId: ctx.orgId,
        createdAt,
      },
      select: { id: true },
    });
    state.locationIds.push(row.id);
  }
  state.counts.locations = state.locationIds.length;

  // One LOCATION_CREATED event per location. Actor is the org owner so the
  // attribution shows "X created this location" consistently — matching the
  // real `createLocation` service, where the caller is always the creator.
  const owner = ctx.actors.real[0] ?? ctx.actors.fake[0];
  const events = state.locationIds.map((locationId) =>
    locationCreatedEvent({
      organizationId: ctx.orgId,
      occurredAt: randomDateBetween(ctx.historyStart, end, ctx.rng),
      actor: owner,
      locationId,
    })
  );
  const written = await flushEvents(ctx.db, events);
  state.counts.activityEvents += written;
}

async function insertTags(
  ctx: SeederContext,
  state: SeederState,
  end: Date
): Promise<void> {
  // The marker tag must exist — the cleanup command uses its name to find
  // seeded assets/bookings. Insert it first and hold onto its id.
  const marker = await ctx.db.tag.create({
    data: {
      name: SEED_TAG_NAME,
      userId: ctx.ownerUserId,
      organizationId: ctx.orgId,
      createdAt: ctx.historyStart,
    },
    select: { id: true },
  });
  state.markerTagId = marker.id;
  state.tagIds.push(marker.id);

  for (const name of TAG_NAMES) {
    const createdAt = randomDateBetween(ctx.historyStart, end, ctx.rng);
    const row = await ctx.db.tag.create({
      data: {
        name: `${name}${NAME_SUFFIX}`,
        color: faker.color.rgb(),
        userId: ctx.ownerUserId,
        organizationId: ctx.orgId,
        createdAt,
      },
      select: { id: true },
    });
    state.tagIds.push(row.id);
  }
  state.counts.tags = state.tagIds.length;
}

async function insertCustomFields(
  ctx: SeederContext,
  state: SeederState,
  end: Date
): Promise<void> {
  for (const cf of CUSTOM_FIELDS) {
    const createdAt = randomDateBetween(ctx.historyStart, end, ctx.rng);
    const row = await ctx.db.customField.create({
      data: {
        name: `${cf.name}${NAME_SUFFIX}`,
        type: cf.type,
        userId: ctx.ownerUserId,
        organizationId: ctx.orgId,
        createdAt,
      },
      select: { id: true },
    });
    state.customFieldIds.push(row.id);
  }
  state.counts.customFields = state.customFieldIds.length;
}
