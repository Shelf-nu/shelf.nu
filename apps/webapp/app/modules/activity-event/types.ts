/**
 * Activity Event — input types for `recordEvent`.
 *
 * A discriminated union over `ActivityAction` so the TypeScript compiler forces
 * callers to supply the correct cross-refs and payload shape for each action.
 * For example, `*_CHANGED` actions require `field`/`fromValue`/`toValue`;
 * `CUSTODY_ASSIGNED` requires `assetId` and at least one of `targetUserId` /
 * `teamMemberId`.
 *
 * See `.claude/rules/use-record-event.md` and
 * `.claude/rules/record-event-payload-shapes.md` for usage rules.
 */

import type { ActivityAction, ActivityEntity, Prisma } from "@prisma/client";

/** Actor snapshot persisted with each event. Survives user rename / deletion. */
export type ActorSnapshot = {
  firstName: string | null;
  lastName: string | null;
  displayName?: string | null;
};

/**
 * Field-change actions — require `field` + `fromValue` + `toValue`. One event
 * per logical field that actually changed; never one umbrella event.
 */
export type FieldChangeAction =
  | "ASSET_NAME_CHANGED"
  | "ASSET_DESCRIPTION_CHANGED"
  | "ASSET_CATEGORY_CHANGED"
  | "ASSET_KIT_CHANGED"
  | "ASSET_LOCATION_CHANGED"
  | "ASSET_TAGS_CHANGED"
  | "ASSET_STATUS_CHANGED"
  | "ASSET_VALUATION_CHANGED"
  | "ASSET_CUSTOM_FIELD_CHANGED"
  | "BOOKING_STATUS_CHANGED"
  | "BOOKING_DATES_CHANGED"
  | "AUDIT_DUE_DATE_CHANGED";

/** Fields shared by every event input. */
type BaseEventInput = {
  organizationId: string;
  actorUserId?: string | null;
  /** Optional pre-computed snapshot; otherwise derived from `actorUserId`. */
  actorSnapshot?: ActorSnapshot | null;
  /** Override the default `now()` — rarely needed. */
  occurredAt?: Date;
  /** Sparse cross-refs; populate whichever apply. */
  assetId?: string;
  bookingId?: string;
  auditSessionId?: string;
  auditAssetId?: string;
  kitId?: string;
  locationId?: string;
  teamMemberId?: string;
  targetUserId?: string;
  /** Action-specific extras. */
  meta?: Prisma.InputJsonValue;
};

/** Event for a `*_CHANGED` action. */
export type FieldChangeEventInput = BaseEventInput & {
  action: FieldChangeAction;
  entityType: ActivityEntity;
  entityId: string;
  /** Logical field name (e.g. "name", "valuation", "status"). */
  field: string;
  fromValue: Prisma.InputJsonValue | null;
  toValue: Prisma.InputJsonValue | null;
};

/** Event for custody assign / release. Entity is the asset. Requires at least custodian info. */
export type CustodyEventInput = BaseEventInput & {
  action: "CUSTODY_ASSIGNED" | "CUSTODY_RELEASED";
  entityType: "ASSET";
  entityId: string;
  assetId: string;
  /** The custodian receiving/releasing custody. At least one of teamMemberId or targetUserId should be set. */
  teamMemberId?: string;
  targetUserId?: string;
};

/**
 * Asset lifecycle events — require `assetId`. Entity is the asset.
 * These are distinct from field changes (CREATED/ARCHIVED/DELETED vs NAME_CHANGED).
 */
export type AssetLifecycleAction =
  | "ASSET_CREATED"
  | "ASSET_ARCHIVED"
  | "ASSET_DELETED";

export type AssetLifecycleEventInput = BaseEventInput & {
  action: AssetLifecycleAction;
  entityType: "ASSET";
  entityId: string;
  assetId: string;
};

/**
 * Audit lifecycle events — require `auditSessionId`. Entity is AUDIT.
 */
export type AuditEventAction = "AUDIT_STARTED" | "AUDIT_COMPLETED";

export type AuditEventInput = BaseEventInput & {
  action: AuditEventAction;
  entityType: "AUDIT";
  entityId: string;
  auditSessionId: string;
};

/**
 * Booking lifecycle events — require `bookingId`. Entity is the booking.
 * Distinct from asset-level booking events (BOOKING_ASSETS_ADDED/REMOVED).
 */
export type BookingLifecycleAction =
  | "BOOKING_CREATED"
  | "BOOKING_CHECKED_OUT"
  | "BOOKING_CHECKED_IN"
  | "BOOKING_PARTIAL_CHECKIN"
  | "BOOKING_CANCELLED"
  | "BOOKING_ARCHIVED";

export type BookingLifecycleEventInput = BaseEventInput & {
  action: BookingLifecycleAction;
  entityType: "BOOKING";
  entityId: string;
  bookingId: string;
};

/** Events for booking asset-list changes (one per item). */
export type BookingAssetItemEventInput = BaseEventInput & {
  action: "BOOKING_ASSETS_ADDED" | "BOOKING_ASSETS_REMOVED";
  entityType: "BOOKING";
  entityId: string;
  bookingId: string;
  assetId: string;
};

/**
 * All remaining actions — the base shape is sufficient.
 * These are actions without specific cross-ref requirements beyond the base fields.
 */
export type GenericEventInput = BaseEventInput & {
  action: Exclude<
    ActivityAction,
    | FieldChangeAction
    | "CUSTODY_ASSIGNED"
    | "CUSTODY_RELEASED"
    | AssetLifecycleAction
    | AuditEventAction
    | BookingLifecycleAction
    | "BOOKING_ASSETS_ADDED"
    | "BOOKING_ASSETS_REMOVED"
  >;
  entityType: ActivityEntity;
  entityId: string;
};

/**
 * Union of all valid inputs to `recordEvent`. The TS compiler enforces which
 * fields are required per action — catch mistakes at call site, not in prod.
 *
 * Order matters for type narrowing: more specific types should come before GenericEventInput.
 */
export type ActivityEventInput =
  | FieldChangeEventInput
  | CustodyEventInput
  | AssetLifecycleEventInput
  | AuditEventInput
  | BookingLifecycleEventInput
  | BookingAssetItemEventInput
  | GenericEventInput;
