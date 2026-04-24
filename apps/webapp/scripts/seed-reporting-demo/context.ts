/**
 * Shared context + mutable state for the reporting-demo seeder.
 *
 * Phase generators consume a `SeederContext` (read-only handles to the DB,
 * RNG, config) and a `SeederState` (accumulator for ids and counts). Each
 * phase appends to `state` so later phases can reference the ids they need
 * (e.g. Phase 5 reaches into `state.assetIds` built by Phase 3).
 */

import type { ExtendedPrismaClient } from "@shelf/database";

import type { ActorPool } from "./actor-pool";
import type { RNG } from "./distributions";

/**
 * Read-only inputs that every phase needs. Built once in the orchestrator
 * before the first phase runs.
 */
export type SeederContext = {
  db: ExtendedPrismaClient;
  orgId: string;
  /** The org owner's user id — used for `userId` FKs on Category / Location / Tag / etc. */
  ownerUserId: string;
  /** Reference "now" used for every `Date.now`-style computation. Frozen at start. */
  now: Date;
  /** Start of the 12-month history window (now - 12 months). */
  historyStart: Date;
  /** Deterministic RNG seeded from CLI `--seed`. */
  rng: RNG;
  /** Pool of real + fake actors, weighted for per-event `pick()`. */
  actors: ActorPool;
};

/**
 * Row totals we accumulate and print in the final summary. Each phase
 * merges its insertions into these counters.
 */
export type SeederCounts = {
  categories: number;
  locations: number;
  tags: number;
  customFields: number;
  teamMembers: number;
  assets: number;
  kits: number;
  bookings: number;
  partialCheckins: number;
  auditSessions: number;
  auditAssets: number;
  auditScans: number;
  custodies: number;
  activityEvents: number;
};

/** Zero-initialised counts object. */
export function emptyCounts(): SeederCounts {
  return {
    categories: 0,
    locations: 0,
    tags: 0,
    customFields: 0,
    teamMembers: 0,
    assets: 0,
    kits: 0,
    bookings: 0,
    partialCheckins: 0,
    auditSessions: 0,
    auditAssets: 0,
    auditScans: 0,
    custodies: 0,
    activityEvents: 0,
  };
}

/**
 * Mutable state the seeder passes phase-to-phase. Each phase appends ids
 * into the appropriate array and bumps counts. Later phases read from
 * the arrays to choose parents / references.
 */
export type SeederState = {
  categoryIds: string[];
  locationIds: string[];
  /** All tag ids, including the marker tag. */
  tagIds: string[];
  /** The one marker tag attached to every seeded asset/booking. */
  markerTagId: string | null;
  customFieldIds: string[];
  /** All team-member ids — real + fake. */
  teamMemberIds: string[];
  assetIds: string[];
  kitIds: string[];
  bookingIds: string[];
  auditSessionIds: string[];
  counts: SeederCounts;
};

/** Fresh state with empty arrays and zero counts. */
export function emptyState(): SeederState {
  return {
    categoryIds: [],
    locationIds: [],
    tagIds: [],
    markerTagId: null,
    customFieldIds: [],
    teamMemberIds: [],
    assetIds: [],
    kitIds: [],
    bookingIds: [],
    auditSessionIds: [],
    counts: emptyCounts(),
  };
}
