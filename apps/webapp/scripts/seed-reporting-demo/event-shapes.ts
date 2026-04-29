/**
 * Typed event-payload builders for the reporting-demo seeder.
 *
 * These helpers construct `ActivityEventInput` values that the seeder bulk-
 * inserts into `ActivityEvent`. They mirror the discriminated union defined
 * in `apps/webapp/app/modules/activity-event/types.ts` so any shape drift
 * in the runtime contract becomes a compile error in the seeder.
 *
 * Every builder accepts a `Partial` of the `BaseEventInput` surface (actor,
 * occurredAt, seeded `meta`) and returns a fully-formed event ready for
 * `activityEvent.createMany`. The seeder funnels all events through
 * `withSeedMarker()` so each one carries `meta.seedRun` — this is how
 * the cleanup command identifies seed rows.
 */

import type { Prisma } from "@shelf/database";

import type { Actor } from "./actor-pool";
import { SEED_META, SEED_RUN_ID } from "./markers";
import type {
  ActivityEventInput,
  ActorSnapshot,
} from "../../app/modules/activity-event/types";

/**
 * Common fields every event builder accepts. `occurredAt` must be supplied
 * — the seeder always backdates, never lets the DB default to `now()`.
 */
type BuilderBase = {
  organizationId: string;
  occurredAt: Date;
  actor: Actor;
  /** Extra action-specific meta. Merged with `{ seedRun }`. */
  extraMeta?: Record<string, Prisma.InputJsonValue>;
};

/**
 * Wrap a caller-supplied `meta` with the seed marker. Callers can pass
 * arbitrary action-specific data (e.g. `{ isExpected: true }`) and the
 * marker is merged in automatically.
 */
function buildMeta(
  extraMeta?: Record<string, Prisma.InputJsonValue>
): Prisma.InputJsonValue {
  if (!extraMeta || Object.keys(extraMeta).length === 0) {
    return SEED_META;
  }
  return { ...extraMeta, seedRun: SEED_RUN_ID };
}

/** Common actor fields extracted from an `Actor`. */
function actorFields(actor: Actor): {
  actorUserId: string | null;
  actorSnapshot: ActorSnapshot;
} {
  return {
    actorUserId: actor.userId,
    actorSnapshot: actor.snapshot,
  };
}

/**
 * `LOCATION_CREATED` — emitted once per location in Phase 2 taxonomy setup.
 * Entity is the location itself.
 */
export function locationCreatedEvent(
  base: BuilderBase & { locationId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "LOCATION_CREATED",
    entityType: "LOCATION",
    entityId: base.locationId,
    locationId: base.locationId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `ASSET_CREATED` — emitted once per asset when it first appears in Shelf.
 * Entity is the asset itself. Used by R7 (Asset Activity Summary) and
 * indirectly by R1/R10 for verification.
 */
export function assetCreatedEvent(
  base: BuilderBase & { assetId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "ASSET_CREATED",
    entityType: "ASSET",
    entityId: base.assetId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * Supported `*_CHANGED` actions for an asset's per-field history.
 * Mirrors the `FieldChangeAction` enum subset that applies to assets.
 */
export type AssetFieldChangeAction =
  | "ASSET_NAME_CHANGED"
  | "ASSET_DESCRIPTION_CHANGED"
  | "ASSET_CATEGORY_CHANGED"
  | "ASSET_LOCATION_CHANGED"
  | "ASSET_VALUATION_CHANGED"
  | "ASSET_KIT_CHANGED";

/**
 * Per-field asset change event. `field` is the logical column name; the
 * `fromValue`/`toValue` payload is stored verbatim as JSON (primitives for
 * name/description/valuation; ids for category/location/kit).
 */
export function assetFieldChangedEvent(
  base: BuilderBase & {
    assetId: string;
    action: AssetFieldChangeAction;
    field: string;
    fromValue: string | number | null;
    toValue: string | number | null;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: base.action,
    entityType: "ASSET",
    entityId: base.assetId,
    assetId: base.assetId,
    field: base.field,
    fromValue: base.fromValue,
    toValue: base.toValue,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `KIT_CREATED` — emitted once per kit. Entity is the kit itself.
 * Asset-to-kit links are instead represented by `ASSET_KIT_CHANGED` per
 * asset (see `assetFieldChangedEvent` with action `"ASSET_KIT_CHANGED"`).
 */
export function kitCreatedEvent(
  base: BuilderBase & { kitId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "KIT_CREATED",
    entityType: "KIT",
    entityId: base.kitId,
    kitId: base.kitId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_CREATED` — emitted once when a booking first exists.
 * Entity is the booking itself.
 */
export function bookingCreatedEvent(
  base: BuilderBase & { bookingId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_CREATED",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_ASSETS_ADDED` — emitted once per asset added to a booking.
 * Matches `BookingAssetItemEventInput` in the runtime types.
 */
export function bookingAssetAddedEvent(
  base: BuilderBase & { bookingId: string; assetId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_ASSETS_ADDED",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_STATUS_CHANGED` — emitted once per transition. `field` is
 * always `"status"`; `fromValue`/`toValue` are the literal enum strings
 * (e.g. `"DRAFT"` → `"RESERVED"`).
 */
export function bookingStatusChangedEvent(
  base: BuilderBase & {
    bookingId: string;
    fromStatus: string;
    toStatus: string;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_STATUS_CHANGED",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    field: "status",
    fromValue: base.fromStatus,
    toValue: base.toStatus,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_CHECKED_OUT` — emitted once per asset at the moment a booking
 * transitions into `ONGOING`. Complements `BOOKING_STATUS_CHANGED` with
 * asset-level granularity for reports like R3 (Top Booked Assets).
 */
export function bookingCheckedOutEvent(
  base: BuilderBase & { bookingId: string; assetId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_CHECKED_OUT",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_CHECKED_IN` — emitted once per asset at the moment a booking
 * transitions into `COMPLETE`. Complements the status event with the same
 * asset-level granularity rationale as check-out.
 */
export function bookingCheckedInEvent(
  base: BuilderBase & { bookingId: string; assetId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_CHECKED_IN",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_PARTIAL_CHECKIN` — emitted once per asset partially checked in
 * during an ongoing booking (before the full `COMPLETE` transition).
 */
export function bookingPartialCheckinEvent(
  base: BuilderBase & { bookingId: string; assetId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_PARTIAL_CHECKIN",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `BOOKING_CANCELLED` — emitted once per booking that ends in CANCELLED.
 * The corresponding `BOOKING_STATUS_CHANGED` event is still emitted
 * separately (semantic-action-plus-status-change pattern, see
 * `CONTEXT-activity-event-architecture.md` §7).
 */
export function bookingCancelledEvent(
  base: BuilderBase & { bookingId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_CANCELLED",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    meta: buildMeta(base.extraMeta),
  };
}

/** `BOOKING_ARCHIVED` — emitted once per booking that ends archived. */
export function bookingArchivedEvent(
  base: BuilderBase & { bookingId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "BOOKING_ARCHIVED",
    entityType: "BOOKING",
    entityId: base.bookingId,
    bookingId: base.bookingId,
    meta: buildMeta(base.extraMeta),
  };
}

/** `AUDIT_CREATED` — emitted at audit-session creation. Entity is the audit. */
export function auditCreatedEvent(
  base: BuilderBase & { auditSessionId: string; expectedAssetCount: number }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_CREATED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    meta: buildMeta({ expectedAssetCount: base.expectedAssetCount }),
  };
}

/** `AUDIT_STARTED` — emitted on the first scan (PENDING → ACTIVE transition). */
export function auditStartedEvent(
  base: BuilderBase & { auditSessionId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_STARTED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    meta: buildMeta(base.extraMeta),
  };
}

/** `AUDIT_ASSETS_ADDED` — per expected asset attached at audit creation. */
export function auditAssetsAddedEvent(
  base: BuilderBase & {
    auditSessionId: string;
    auditAssetId: string;
    assetId: string;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_ASSETS_ADDED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    auditAssetId: base.auditAssetId,
    assetId: base.assetId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `AUDIT_ASSET_SCANNED` — one per scan. `meta.isExpected` differentiates
 * scans of expected assets (incrementing `foundCount`) from scans of
 * unexpected ones (incrementing `unexpectedCount`). Used by the audit
 * completion report.
 */
export function auditAssetScannedEvent(
  base: BuilderBase & {
    auditSessionId: string;
    auditAssetId: string;
    assetId: string;
    isExpected: boolean;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_ASSET_SCANNED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    auditAssetId: base.auditAssetId,
    assetId: base.assetId,
    meta: buildMeta({ isExpected: base.isExpected }),
  };
}

/**
 * `AUDIT_COMPLETED` — emitted once with full counter set in `meta`. This
 * is the single most-read row for audit-completion reports.
 */
export function auditCompletedEvent(
  base: BuilderBase & {
    auditSessionId: string;
    expectedCount: number;
    foundCount: number;
    missingCount: number;
    unexpectedCount: number;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_COMPLETED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    meta: buildMeta({
      expectedCount: base.expectedCount,
      foundCount: base.foundCount,
      missingCount: base.missingCount,
      unexpectedCount: base.unexpectedCount,
    }),
  };
}

/** `AUDIT_CANCELLED` — emitted once per cancelled audit. */
export function auditCancelledEvent(
  base: BuilderBase & { auditSessionId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_CANCELLED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    meta: buildMeta(base.extraMeta),
  };
}

/** `AUDIT_ARCHIVED` — emitted once per archived audit. */
export function auditArchivedEvent(
  base: BuilderBase & { auditSessionId: string }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "AUDIT_ARCHIVED",
    entityType: "AUDIT",
    entityId: base.auditSessionId,
    auditSessionId: base.auditSessionId,
    meta: buildMeta(base.extraMeta),
  };
}

/**
 * `CUSTODY_ASSIGNED` — emitted when a TeamMember takes custody of an asset.
 * Entity is the asset (not the custodian) — matches the feed-UI mental model
 * where the event lives on the asset's activity tab.
 */
export function custodyAssignedEvent(
  base: BuilderBase & {
    assetId: string;
    teamMemberId: string;
    targetUserId?: string;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "CUSTODY_ASSIGNED",
    entityType: "ASSET",
    entityId: base.assetId,
    assetId: base.assetId,
    teamMemberId: base.teamMemberId,
    targetUserId: base.targetUserId,
    meta: buildMeta(base.extraMeta),
  };
}

/** `CUSTODY_RELEASED` — mirror of `CUSTODY_ASSIGNED`. */
export function custodyReleasedEvent(
  base: BuilderBase & {
    assetId: string;
    teamMemberId: string;
    targetUserId?: string;
  }
): ActivityEventInput {
  return {
    ...actorFields(base.actor),
    organizationId: base.organizationId,
    occurredAt: base.occurredAt,
    action: "CUSTODY_RELEASED",
    entityType: "ASSET",
    entityId: base.assetId,
    assetId: base.assetId,
    teamMemberId: base.teamMemberId,
    targetUserId: base.targetUserId,
    meta: buildMeta(base.extraMeta),
  };
}
