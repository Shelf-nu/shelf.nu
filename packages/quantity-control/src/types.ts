/**
 * `@shelf/quantity-control` — shared domain types.
 *
 * The pure, dependency-free vocabulary of the QUANTITY_TRACKED availability
 * domain. This module owns:
 *
 *   - The `Qt*` string-union enums whose literals are byte-identical to the
 *     database enum values (`AssetType`, `ConsumptionType`,
 *     `ConsumptionCategory`, `BookingStatus` in `schema.prisma`). The package
 *     is deliberately free of `@prisma/client` (Metro-safe, zero runtime
 *     deps), so it re-declares the enum literals here rather than importing
 *     them. Each union is paired with a runtime `QT_*` frozen array (the
 *     union type is DERIVED from the array, so the two can never drift), which
 *     the enum-parity test asserts against a copied list of the schema's enum
 *     values — the cheap regression guard against schema drift.
 *   - The availability value-object shapes (`AvailabilityInterval`,
 *     `AvailabilityWindow`, `AvailabilityInputs`, `AvailabilityBreakdown`)
 *     consumed by `./availability` and `./guards`.
 *
 * @see {@link file://../../database/prisma/schema.prisma} — the enums these mirror.
 */

/* -------------------------------------------------------------------------- */
/*                          Database-mirroring enums                          */
/* -------------------------------------------------------------------------- */

/**
 * Every `BookingStatus` value (mirrors the schema enum). The union type
 * {@link QtBookingStatus} is derived from this array so a value can never be
 * added to one without the other.
 */
export const QT_BOOKING_STATUSES = [
  "DRAFT",
  "RESERVED",
  "ONGOING",
  "OVERDUE",
  "COMPLETE",
  "CANCELLED",
  "ARCHIVED",
] as const;

/** A booking's lifecycle status. Literals equal the DB `BookingStatus` enum. */
export type QtBookingStatus = (typeof QT_BOOKING_STATUSES)[number];

/**
 * Every `ConsumptionCategory` value (mirrors the schema enum). The union type
 * {@link QtConsumptionCategory} is derived from this array.
 */
export const QT_CONSUMPTION_CATEGORIES = [
  "CHECKOUT",
  "RETURN",
  "CONSUME",
  "LOSS",
  "DAMAGE",
  "RESTOCK",
  "ADJUSTMENT",
] as const;

/** A consumption-log entry's category. Literals equal the DB `ConsumptionCategory` enum. */
export type QtConsumptionCategory = (typeof QT_CONSUMPTION_CATEGORIES)[number];

/**
 * Every `AssetType` value (mirrors the schema enum). The union type
 * {@link QtAssetType} is derived from this array.
 */
export const QT_ASSET_TYPES = ["INDIVIDUAL", "QUANTITY_TRACKED"] as const;

/** An asset's tracking mode. Literals equal the DB `AssetType` enum. */
export type QtAssetType = (typeof QT_ASSET_TYPES)[number];

/**
 * Every `ConsumptionType` value (mirrors the schema enum). The union type
 * {@link QtConsumptionType} is derived from this array.
 */
export const QT_CONSUMPTION_TYPES = ["ONE_WAY", "TWO_WAY"] as const;

/** How a QUANTITY_TRACKED asset behaves after checkout. Literals equal the DB `ConsumptionType` enum. */
export type QtConsumptionType = (typeof QT_CONSUMPTION_TYPES)[number];

/* -------------------------------------------------------------------------- */
/*                       Availability value-objects                           */
/* -------------------------------------------------------------------------- */

/**
 * A committed booking interval competing for an asset's pool — one row in the
 * peak-concurrency sweep ({@link file://./availability.ts}). `from`/`to` are
 * the (end-exclusive) occupancy window; `qty` is the booked amount minus any
 * already-logged reservation-reducing dispositions.
 */
export type AvailabilityInterval = { from: Date; to: Date; qty: number };

/**
 * A date range to window reservation math over. `null` means "no window" —
 * reservations are summed informationally rather than peaked.
 */
export type AvailabilityWindow = { from: Date; to: Date } | null;

/**
 * The already-resolved pool components for one asset over a target window.
 * The adapter (webapp) runs the Prisma queries + row locks and maps rows into
 * this shape; the package's {@link file://./availability.ts} `computeAvailability`
 * turns it into a {@link AvailabilityBreakdown}. Every field is a
 * non-negative unit count.
 */
export type AvailabilityInputs = {
  /** `Asset.quantity` — total units owned. */
  total: number;
  /** OPERATOR custody only (`kitCustodyId IS NULL`). */
  inCustody: number;
  /** Σ `AssetKit.quantity` — units currently allocated into kits. */
  inKits: number;
  /** Peak concurrent reserved demand over the target window (kit slices excluded). */
  reservedPeak: number;
  /** Units physically off-shelf right now (ONGOING/OVERDUE checkouts). */
  checkedOut: number;
};

/**
 * The two availability headline figures. Both are **signed** — the primitive
 * never clamps, so a write guard can distinguish "already over-committed"
 * (negative) from "exactly at capacity" (zero). Callers clamp to 0 only for
 * display.
 */
export type AvailabilityBreakdown = {
  /** `total − inCustody − inKits − checkedOut` — physical-now headline (SIGNED). */
  physicalAvailable: number;
  /** `total − inCustody − inKits − reservedPeak` — bookable-for-window (SIGNED). */
  bookable: number;
};
