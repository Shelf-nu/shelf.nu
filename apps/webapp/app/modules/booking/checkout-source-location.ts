/**
 * Which location a booking slice's units leave from (pure, no DB access).
 *
 * A quantity-tracked asset ("pool") can be placed at several locations. When a
 * booking checks such a pool out, Shelf asks once where the units come from and
 * records the answer on the slice (`BookingAsset.sourceLocationId`). Check-in
 * then takes consumed, lost and damaged units off that location, so the
 * placements stay true without anyone moving numbers by hand.
 *
 * The rule, in the order it is applied to each slice:
 *   1. A slice already sent out keeps the source it has (a re-dispatch never
 *      asks again, and never overwrites an earlier answer).
 *   2. A kit-driven slice takes its kit's location. Its units belong to the
 *      kit, never to a manual placement, so nothing is asked.
 *   3. A submitted answer wins. It must name a manual placement of the pool,
 *      or be "Unplaced" (`null`) while the pool has unplaced units.
 *   4. Otherwise the default: no placements, or one placement next to
 *      unplaced units, record nothing (`null`: the unplaced units absorb any
 *      drop, which is also what a slice with no recorded source does); one placement and no unplaced units record
 *      that location; two or more placements record the one with the most
 *      units left. That last case is a guess, which is why the booking shows
 *      it on the asset row.
 *
 * Only pools at two or more manual placements are ever asked
 * ({@link poolAsksForSource}); everything else resolves silently.
 *
 * @see {@link file://./checkout-source-location.server.ts} the DB side
 * @see {@link file://../asset/placement-reconcile.server.ts} what check-in does with the answer
 */

import { z } from "zod";

/**
 * Form value an "Unplaced" option submits. A `<select>` cannot submit `null`,
 * and a missing field has to stay distinguishable from "Unplaced" (a missing
 * field means "not asked", which resolves to the default).
 */
export const UNPLACED_SOURCE_FORM_VALUE = "";

/** Prefix of the form fields that carry a source per slice or asset. */
export const SOURCE_LOCATION_FIELD_PREFIX = "sourceLocation.";

/**
 * Name of the form field that carries the source for one slice (keyed by
 * `BookingAsset.id`) or one asset (keyed by `Asset.id`, for flows that add the
 * slice in the same request, such as fulfil-and-check-out).
 *
 * @param key - A `BookingAsset.id` or an `Asset.id`
 * @returns The field name
 */
export function sourceLocationFieldName(key: string): string {
  return `${SOURCE_LOCATION_FIELD_PREFIX}${key}`;
}

/**
 * Submitted sources, keyed by `BookingAsset.id` or `Asset.id`. A value of
 * `null` is an explicit "Unplaced"; a missing key means nothing was submitted
 * for that slice.
 */
export type SourceLocationSubmission = ReadonlyMap<string, string | null>;

/** An empty submission, for callers that ask nothing. */
export const NO_SOURCE_SUBMISSION: SourceLocationSubmission = new Map();

/**
 * Read the per-slice source fields out of a web form.
 *
 * @param formData - The submitted form
 * @returns Every `sourceLocation.<key>` field, with the unplaced sentinel
 *   turned into `null`
 */
export function parseSourceLocationsFromFormData(
  formData: FormData
): SourceLocationSubmission {
  const submission = new Map<string, string | null>();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(SOURCE_LOCATION_FIELD_PREFIX)) continue;
    const key = name.slice(SOURCE_LOCATION_FIELD_PREFIX.length);
    if (!key || typeof value !== "string") continue;
    submission.set(key, value === UNPLACED_SOURCE_FORM_VALUE ? null : value);
  }
  return submission;
}

/**
 * Turn the mobile API's `sourceLocations` object into a submission.
 *
 * @param record - `{ [bookingAssetId or assetId]: locationId | null }`, or
 *   `undefined` from an app that does not send the field
 * @returns The same pairs as a map (an empty `""` also means "Unplaced")
 */
export function sourceSubmissionFromRecord(
  record: Record<string, string | null> | null | undefined
): SourceLocationSubmission {
  const submission = new Map<string, string | null>();
  for (const [key, value] of Object.entries(record ?? {})) {
    if (!key) continue;
    submission.set(
      key,
      value === null || value === UNPLACED_SOURCE_FORM_VALUE ? null : value
    );
  }
  return submission;
}

/**
 * The mobile API's optional `sourceLocations` body field:
 * `{ [bookingAssetId or assetId]: locationId | null }`, `null` (or `""`) for
 * "Unplaced". Optional, so an app that does not know the field keeps working
 * and gets the default for every pool.
 */
export const mobileSourceLocationsSchema = z
  .record(z.string().min(1), z.string().nullable())
  .optional();

/** One manual placement of a pool, as the source question sees it. */
export type SourcePlacement = {
  locationId: string;
  /** Location name, for the option label and error messages. */
  name: string;
  /** Units placed there (`AssetLocation.quantity`). */
  placed: number;
  /** Units in custody taken from there. */
  inCustody: number;
  /** Units out on other bookings that left from there. */
  onBooking: number;
  /**
   * Units that location has left to give: placed minus both of the above.
   * Drives the default.
   */
  left: number;
};

/**
 * Where a pool's units sit, read inside the check-out transaction.
 *
 * `placements` are the MANUAL placements only (`assetKitId IS NULL`), in the
 * order they were created: that order breaks ties in the default, so the
 * dialog's pre-selection and the server's default agree.
 */
export type PoolSourceSnapshot = {
  placements: SourcePlacement[];
  /** `Asset.quantity` minus the manual placements, never below 0. */
  unplaced: number;
};

/**
 * One pool on a booking that a check-out dialog asks about. Built by
 * `getCheckoutSourceQuestions` in the server module and sent to the dialogs
 * as plain data.
 */
export type CheckoutSourceQuestion = {
  /** The slice the answer is recorded on (`BookingAsset.id`). */
  sliceId: string;
  assetId: string;
  title: string;
  unitOfMeasure: string | null;
  /** Units this slice sends out. */
  quantity: number;
  placements: SourcePlacement[];
  unplaced: number;
  /** The option to pre-select: the server's answer when nothing is picked. */
  defaultLocationId: string | null;
};

/**
 * The words for a count of a pool's units: its unit of measure, or "units".
 *
 * @param unitOfMeasure - `Asset.unitOfMeasure`
 * @returns The label to print after a number
 */
export function sourceUnitLabel(unitOfMeasure: string | null): string {
  return unitOfMeasure?.trim() || "units";
}

/**
 * The options a "From location" select offers for one pool: each manual
 * placement as "Camera Room · 60 pcs", with "· 10 in custody" and "· 20 on a
 * booking" when some of those units are out, then "Unplaced · 5 pcs" when the
 * pool has unplaced units. The same words as the location page's row and the
 * custody dialog.
 *
 * @param question - The pool being asked about
 * @returns `value` is the form value (a location id, or the unplaced sentinel)
 */
export function checkoutSourceOptions(
  question: Pick<
    CheckoutSourceQuestion,
    "placements" | "unplaced" | "unitOfMeasure"
  >
): Array<{ value: string; label: string }> {
  const unit = sourceUnitLabel(question.unitOfMeasure);
  const options = question.placements.map((placement) => {
    let label = `${placement.name} · ${placement.placed} ${unit}`;
    if (placement.inCustody > 0)
      label += ` · ${placement.inCustody} in custody`;
    if (placement.onBooking > 0)
      label += ` · ${placement.onBooking} on a booking`;
    return { value: placement.locationId, label };
  });
  if (question.unplaced > 0) {
    options.push({
      value: UNPLACED_SOURCE_FORM_VALUE,
      label: `Unplaced · ${question.unplaced} ${unit}`,
    });
  }
  return options;
}

/**
 * Whether a check-out asks where this pool's units come from.
 *
 * @param snapshot - The pool's placements
 * @returns `true` for a pool at two or more manual placements
 */
export function poolAsksForSource(snapshot: PoolSourceSnapshot): boolean {
  return snapshot.placements.length >= 2;
}

/**
 * The source a slice gets when nobody picked one: also the option the
 * check-out dialog pre-selects.
 *
 * @param snapshot - The pool's placements
 * @returns A location id, or `null` for "record nothing"
 */
export function defaultSourceLocationId(
  snapshot: PoolSourceSnapshot
): string | null {
  const { placements, unplaced } = snapshot;
  if (placements.length === 0) return null;
  if (placements.length === 1) {
    // One placement next to unplaced units is never asked about, so which of
    // the two the units came from is unknown. Recording nothing lets the
    // unplaced pile absorb a drop, the same as for any pool with no source.
    return unplaced > 0 ? null : placements[0].locationId;
  }
  // Two or more: the one with the most units left. A strict `>` keeps the
  // earliest-created placement on a tie.
  let best = placements[0];
  for (const placement of placements.slice(1)) {
    if (placement.left > best.left) best = placement;
  }
  return best.locationId;
}

/** Everything {@link resolveSliceSource} needs about one slice. */
export type SliceSourceInput = {
  /** `BookingAsset.checkedOutQuantity` BEFORE this check-out adds to it. */
  checkedOutQuantity: number;
  /** `BookingAsset.assetKitId` is set: the slice came with a kit. */
  isKitSlice: boolean;
  /** The kit's `Kit.locationId` for a kit slice; ignored otherwise. */
  kitLocationId: string | null;
  /**
   * The answer submitted for this slice, or `undefined` when none was sent.
   * `{ locationId: null }` is an explicit "Unplaced".
   */
  submitted: { locationId: string | null } | undefined;
  /** The pool's placements. Unused for kit slices. */
  snapshot: PoolSourceSnapshot;
};

/** Where the source came from, for tests and the audit trail. */
export type SliceSourceReason =
  | "kit"
  | "submitted"
  | "unplaced"
  | "only-placement"
  | "no-placement"
  | "placement-and-unplaced"
  | "most-left";

/** What {@link resolveSliceSource} decided for one slice. */
export type SliceSourceDecision =
  /** The slice was sent out before: keep whatever it recorded then. */
  | { action: "keep" }
  | {
      action: "record";
      locationId: string | null;
      reason: SliceSourceReason;
    }
  /**
   * The submitted answer names nothing this pool has: a location it is not
   * placed at, or Unplaced (`null`) when none of its units are unplaced.
   */
  | { action: "invalid"; locationId: string | null };

/**
 * Decide the source of one slice at the moment it is checked out.
 *
 * @param input - {@link SliceSourceInput}
 * @returns {@link SliceSourceDecision}
 */
export function resolveSliceSource(
  input: SliceSourceInput
): SliceSourceDecision {
  if (input.checkedOutQuantity > 0) {
    return { action: "keep" };
  }

  if (input.isKitSlice) {
    return { action: "record", locationId: input.kitLocationId, reason: "kit" };
  }

  const { submitted, snapshot } = input;
  if (submitted) {
    if (submitted.locationId === null) {
      // Unplaced is a choice only while the pool has unplaced units, the same
      // options the dialog offers.
      return snapshot.unplaced > 0
        ? { action: "record", locationId: null, reason: "unplaced" }
        : { action: "invalid", locationId: null };
    }
    const placed = snapshot.placements.some(
      (placement) => placement.locationId === submitted.locationId
    );
    return placed
      ? {
          action: "record",
          locationId: submitted.locationId,
          reason: "submitted",
        }
      : { action: "invalid", locationId: submitted.locationId };
  }

  const locationId = defaultSourceLocationId(snapshot);
  const { placements } = snapshot;
  let reason: SliceSourceReason;
  if (placements.length === 0) reason = "no-placement";
  else if (placements.length === 1)
    reason = locationId === null ? "placement-and-unplaced" : "only-placement";
  else reason = "most-left";
  return { action: "record", locationId, reason };
}

/**
 * Find the answer submitted for a slice. A slice-keyed answer wins over an
 * asset-keyed one, so a client that knows the slice can be exact while a flow
 * that adds the slice in the same request can key by asset.
 *
 * @param submission - Everything submitted
 * @param slice - The slice's own id and its asset's id
 * @returns The answer, or `undefined` when none was sent for this slice
 */
export function submittedSourceForSlice(
  submission: SourceLocationSubmission,
  slice: { id: string; assetId: string }
): { locationId: string | null } | undefined {
  if (submission.has(slice.id)) {
    return { locationId: submission.get(slice.id) ?? null };
  }
  if (submission.has(slice.assetId)) {
    return { locationId: submission.get(slice.assetId) ?? null };
  }
  return undefined;
}

/** The slice fields check-in reads to find where used-up units come off. */
export type CheckinSourceSlice = {
  id: string;
  assetId: string;
  assetKitId: string | null;
  sourceLocationId: string | null;
};

/**
 * Which manual placement loses the units a check-in reports consumed, lost or
 * damaged: the slice's recorded source, for all three. Returned units never
 * change a placement, so they are not counted.
 *
 * Nothing is returned (the unplaced units absorb the drop) for a slice with
 * no recorded source, and for a kit slice: its units belong to the kit, whose
 * own placement shrinks with it, never a manual one.
 *
 * @param args.slice - The slice being checked in, or `null` when unknown
 * @param args.consumed - Units used up
 * @param args.lost - Units lost
 * @param args.damaged - Units damaged
 * @returns The `sources` for `reconcileManualPlacementsForStockDecrease`
 */
export function checkinPlacementSources({
  slice,
  consumed = 0,
  lost = 0,
  damaged = 0,
}: {
  slice: Pick<CheckinSourceSlice, "assetKitId" | "sourceLocationId"> | null;
  consumed?: number;
  lost?: number;
  damaged?: number;
}): Array<{ locationId: string; quantity: number }> {
  if (!slice || slice.assetKitId || !slice.sourceLocationId) return [];
  const quantity = consumed + lost + damaged;
  return quantity > 0 ? [{ locationId: slice.sourceLocationId, quantity }] : [];
}

/**
 * The slice a check-in disposition belongs to. A disposition that names its
 * slice gets that slice. One that does not (an older phone app) gets the
 * asset's only slice on the booking; with several slices the owner is
 * unknown and nothing is guessed.
 *
 * @param slices - The booking's slices
 * @param disposition - The asset and, when the client knows it, the slice
 * @returns The slice, or `null` when it cannot be told
 */
export function sliceForDisposition<T extends CheckinSourceSlice>(
  slices: readonly T[],
  disposition: { assetId: string; bookingAssetId?: string | null }
): T | null {
  if (disposition.bookingAssetId) {
    return (
      slices.find(
        (slice) =>
          slice.id === disposition.bookingAssetId &&
          slice.assetId === disposition.assetId
      ) ?? null
    );
  }
  const ofAsset = slices.filter(
    (slice) => slice.assetId === disposition.assetId
  );
  return ofAsset.length === 1 ? ofAsset[0] : null;
}
