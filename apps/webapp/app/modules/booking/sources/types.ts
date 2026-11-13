/**
 * Booking sources: shared pure types.
 *
 * The vocabulary the booking sources layer uses for a group of slices (every
 * slice of one asset on one booking), its allocation modes, and the
 * quantity-level disposition shares that attribute each disposition log to a
 * slice and a source row. No runtime code and no database types live here, so
 * the pure planners and their tests can import it freely.
 *
 * @see {@link file://./conversion.ts} the legacy conversion planner
 * @see superpowers/2026-11-10-booking-source-locations-design.md sections 6 and 12.2
 */

/** Identity of a group: every slice of one asset on one booking. */
export type GroupKey = { bookingId: string; assetId: string };

/**
 * How a slice holds its units.
 * - `LEGACY`: unconverted group, today's behaviour, no shares and no sources.
 * - `KIT`: live kit slice of a converted group, one KIT source row.
 * - `AUTO` / `MANUAL`: standalone slice of a converted group, loose source rows.
 */
export type SourceAllocationMode = "LEGACY" | "KIT" | "AUTO" | "MANUAL";

/**
 * How a disposition share was made: `SEEDED` by conversion, `RECORDED` by a
 * writer, `OVERFLOW` for conversion quantity that fitted no slice. Audit only.
 */
export type ShareOrigin = "SEEDED" | "RECORDED" | "OVERFLOW";

/** A disposition share before it is written. */
export type PlannedShare = {
  /** The disposition log this share is part of. */
  consumptionLogId: string;
  /** The slice the units count against, or null for an orphaned share. */
  bookingAssetId: string | null;
  /**
   * `sourceKey` of the source row the units count against (the carrier row of
   * a standalone slice, the KIT row of a kit slice), or null when the share
   * has no slice or its row is not decided yet.
   */
  sourceKey: string | null;
  /** Units of the log this share covers. Always a positive integer. */
  quantity: number;
  /** How the share was made. */
  origin: ShareOrigin;
};

/** One slice of a legacy group, as conversion reads it. */
export type ConversionSlice = {
  /** `BookingAsset.id`. */
  id: string;
  /** Booked units (`Q`). */
  quantity: number;
  /** Lifetime units checked out on the slice (`D`). */
  checkedOutQuantity: number;
  /** Set when the slice is driven by a kit. */
  assetKitId: string | null;
  /** The recorded manual placement the units left from, when known. */
  sourceLocationId: string | null;
  /** True when the recorded source was the unplaced units. */
  recordedSourceIsUnplaced: boolean;
};

/** One disposition log of a group, as conversion reads it. */
export type ConversionLog = {
  /** `ConsumptionLog.id`. */
  id: string;
  /** The slice the log is tagged with, or null for the untagged pool. */
  bookingAssetId: string | null;
  /** Units the log disposed of. */
  quantity: number;
  /** When the log was written; orders the untagged pool and re-marking. */
  createdAt: Date;
};

/** A time window, half-open: `[from, to)`. */
export type Window = { from: Date; to: Date };
