/**
 * Record which location a booking slice's units leave from (DB side).
 *
 * Every check-out writer calls {@link dispatchCheckoutSources} inside its own
 * transaction, right before it adds to `BookingAsset.checkedOutQuantity`.
 * Slices with source rows (converted groups) dispatch from those rows through
 * the booking sources facade; LEGACY slices go through
 * {@link recordCheckoutSourceLocations}, whose pure rule lives in
 * {@link file://./checkout-source-location.ts}.
 *
 * The check-out dialogs read the same data through
 * {@link getCheckoutSourceQuestions}, so the option the dialog pre-selects is
 * the answer the server uses when nothing is submitted.
 *
 * @see {@link file://./checkout-source-location.ts}
 * @see {@link file://./sources/booking-sources.server.ts} `dispatchUnits`
 * @see {@link file://./service.server.ts} the check-out writers
 */

import { AssetType } from "@prisma/client";
import {
  describeBookingSources,
  formatSourceSummary,
} from "@shelf/quantity-control";

import { db } from "~/database/db.server";
import type { ExtendedPrismaClient } from "~/database/db.server";
import type { CustodySourceState } from "~/modules/asset/custody-source";
import {
  bookedOutFromSource,
  custodyFromSource,
  unitsLeftAtSource,
} from "~/modules/asset/custody-source";
import { BOOKING_SOURCES_ENABLED } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

import type {
  CheckoutSourceQuestion,
  PoolSourceSnapshot,
  SliceSourceDecision,
  SourceLocationSubmission,
  SourcePlacement,
} from "./checkout-source-location";
import {
  ALLOCATION_SOURCE_FORM_VALUE,
  defaultSourceLocationId,
  NO_SOURCE_SUBMISSION,
  poolAsksForSource,
  resolveSliceSource,
  submittedSourceForSlice,
} from "./checkout-source-location";
import { dispatchUnits } from "./sources/booking-sources.server";
import type { DispatchedSlice } from "./sources/booking-sources.server";
import { loadUnitsOutBySource } from "./sources/capacity.server";
import type { BookingSourcesTx } from "./sources/conversion.server";

const label: ErrorLabel = "Booking";

/**
 * The client surface this module reads and writes through. A `Pick` of the
 * extended client, so both the root `db` and an interactive transaction
 * client (which is the same client minus its `$` methods) satisfy it.
 */
type SourceTxClient = Pick<
  ExtendedPrismaClient,
  | "asset"
  | "assetLocation"
  | "assetKit"
  | "bookingAsset"
  | "bookingAssetSource"
  | "consumptionLog"
  | "custody"
  | "kit"
>;

/** A pool's placements plus what the dialogs print about it. */
export type PoolSourceSnapshotWithAsset = PoolSourceSnapshot & {
  assetId: string;
  title: string;
  unitOfMeasure: string | null;
};

/**
 * Read where each pool's units sit.
 *
 * Call it inside the check-out transaction, after the pool's row lock, so the
 * placements cannot change between the read and the write that relies on it.
 *
 * @param tx - Transaction client (or `db` for a read-only loader)
 * @param args.organizationId - Scopes every read; a foreign asset reads as absent
 * @param args.assetIds - The pools to read
 * @returns One snapshot per asset found in this organization
 */
export async function loadPoolSourceSnapshots(
  tx: SourceTxClient,
  { organizationId, assetIds }: { organizationId: string; assetIds: string[] }
): Promise<Map<string, PoolSourceSnapshotWithAsset>> {
  const snapshots = new Map<string, PoolSourceSnapshotWithAsset>();
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) return snapshots;

  const [assets, placements, operatorCustody, bookedOut] = await Promise.all([
    tx.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: by-id snapshot of pools on the booking being checked out; archive refusal is the guard's job
      where: { id: { in: uniqueAssetIds }, organizationId },
      select: { id: true, title: true, quantity: true, unitOfMeasure: true },
    }),
    tx.assetLocation.findMany({
      // Manual placements only: kit-driven rows (`assetKitId` set) belong to
      // the kit and are never a source a person picks.
      where: {
        assetId: { in: uniqueAssetIds },
        organizationId,
        assetKitId: null,
      },
      select: {
        assetId: true,
        locationId: true,
        quantity: true,
        location: { select: { name: true } },
      },
      // Creation order breaks ties in the default; `id` keeps it total.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    // Operator custody only: kit-inherited rows follow their kit. What is in
    // custody from a location is not left there to hand out.
    tx.custody.findMany({
      where: {
        assetId: { in: uniqueAssetIds },
        kitCustodyId: null,
        asset: { organizationId },
      },
      select: {
        assetId: true,
        locationId: true,
        sourceUnknown: true,
        quantity: true,
      },
    }),
    // Units out on bookings from each source are not there either: LEGACY
    // groups by their recorded location, converted groups by their rows.
    loadUnitsOutBySource(tx, { assetIds: uniqueAssetIds, organizationId }),
  ]);

  const placementsByAsset = new Map<string, SourcePlacement[]>();
  for (const placement of placements) {
    const list = placementsByAsset.get(placement.assetId) ?? [];
    list.push({
      locationId: placement.locationId,
      name: placement.location.name,
      placed: placement.quantity,
      inCustody: 0,
      onBooking: 0,
      left: placement.quantity,
    });
    placementsByAsset.set(placement.assetId, list);
  }

  for (const asset of assets) {
    const assetPlacements = placementsByAsset.get(asset.id) ?? [];
    const placedSum = assetPlacements.reduce((sum, p) => sum + p.placed, 0);
    // Units left = placed, minus custody taken from there, minus units out
    // on bookings from there: the one definition custody's own "From
    // location" uses, so both questions agree.
    const state: CustodySourceState = {
      total: asset.quantity ?? 0,
      placements: assetPlacements.map((p) => ({
        locationId: p.locationId,
        quantity: p.placed,
      })),
      operatorCustody: operatorCustody.filter((c) => c.assetId === asset.id),
      bookedOut: bookedOut.get(asset.id) ?? [],
    };
    for (const placement of assetPlacements) {
      placement.inCustody = custodyFromSource(state, placement.locationId);
      placement.onBooking = bookedOutFromSource(state, placement.locationId);
      placement.left = unitsLeftAtSource(state, placement.locationId);
    }
    snapshots.set(asset.id, {
      assetId: asset.id,
      title: asset.title,
      unitOfMeasure: asset.unitOfMeasure,
      placements: assetPlacements,
      unplaced: Math.max(0, (asset.quantity ?? 0) - placedSum),
      unplacedLeft: unitsLeftAtSource(state, null),
    });
  }

  return snapshots;
}

/**
 * The location of the kit behind each kit-driven slice's membership row.
 *
 * @param tx - Transaction client
 * @param args.organizationId - Scopes both reads
 * @param args.membershipIds - `BookingAsset.assetKitId` values (`AssetKit.id`)
 * @returns The kit's `locationId` (possibly `null`) per membership id
 */
async function loadKitLocationsByMembership(
  tx: SourceTxClient,
  {
    organizationId,
    membershipIds,
  }: { organizationId: string; membershipIds: string[] }
): Promise<Map<string, string | null>> {
  const byMembership = new Map<string, string | null>();
  if (membershipIds.length === 0) return byMembership;

  const memberships = await tx.assetKit.findMany({
    where: { id: { in: [...new Set(membershipIds)] }, organizationId },
    select: { id: true, kitId: true },
  });
  const kits = await tx.kit.findMany({
    where: {
      id: { in: [...new Set(memberships.map((m) => m.kitId))] },
      organizationId,
    },
    select: { id: true, locationId: true },
  });
  const locationByKitId = new Map(kits.map((kit) => [kit.id, kit.locationId]));
  for (const membership of memberships) {
    byMembership.set(
      membership.id,
      locationByKitId.get(membership.kitId) ?? null
    );
  }
  return byMembership;
}

/**
 * Record the source of every quantity-tracked slice this check-out sends out
 * for the first time.
 *
 * Only slices whose `checkedOutQuantity` is still 0 are touched, so the call
 * must come BEFORE the caller adds to that counter. A slice sent out before
 * keeps its source; individual assets are skipped (they have no pool to
 * split).
 *
 * @param tx - The check-out's transaction client
 * @param args.organizationId - Scopes every read
 * @param args.sliceIds - `BookingAsset` ids this check-out is about to send out
 * @param args.submission - Answers from the dialog or the phone, keyed by slice
 *   or asset id; empty when nobody was asked
 * @returns The decision per slice id, for callers that log or test it
 * @throws {ShelfError} 400 when a submitted location is not a manual placement
 *   of that pool in this organization. The caller's transaction rolls back, so
 *   nothing leaves.
 */
export async function recordCheckoutSourceLocations(
  tx: SourceTxClient,
  {
    organizationId,
    sliceIds,
    submission = NO_SOURCE_SUBMISSION,
  }: {
    organizationId: string;
    sliceIds: string[];
    submission?: SourceLocationSubmission;
  }
): Promise<Map<string, SliceSourceDecision>> {
  const decisions = new Map<string, SliceSourceDecision>();
  const uniqueSliceIds = [...new Set(sliceIds)];
  if (uniqueSliceIds.length === 0) return decisions;

  const slices = await tx.bookingAsset.findMany({
    where: {
      id: { in: uniqueSliceIds },
      checkedOutQuantity: 0,
      booking: { organizationId },
      asset: { type: AssetType.QUANTITY_TRACKED, organizationId },
    },
    select: { id: true, assetId: true, assetKitId: true },
  });
  if (slices.length === 0) return decisions;

  const kitLocationByMembershipId = await loadKitLocationsByMembership(tx, {
    organizationId,
    membershipIds: slices
      .map((slice) => slice.assetKitId)
      .filter((id): id is string => Boolean(id)),
  });

  const snapshots = await loadPoolSourceSnapshots(tx, {
    organizationId,
    assetIds: slices
      .filter((slice) => !slice.assetKitId)
      .map((slice) => slice.assetId),
  });

  const sliceIdsBySource = new Map<string | null, string[]>();
  for (const slice of slices) {
    const snapshot = snapshots.get(slice.assetId) ?? {
      placements: [],
      unplaced: 0,
      unplacedLeft: 0,
    };
    const decision = resolveSliceSource({
      checkedOutQuantity: 0,
      isKitSlice: Boolean(slice.assetKitId),
      kitLocationId: slice.assetKitId
        ? kitLocationByMembershipId.get(slice.assetKitId) ?? null
        : null,
      submitted: submittedSourceForSlice(submission, slice),
      snapshot,
    });
    decisions.set(slice.id, decision);

    if (decision.action === "invalid") {
      const title = snapshots.get(slice.assetId)?.title ?? "This asset";
      const names = [
        ...snapshot.placements.map((p) => p.name),
        ...(snapshot.unplaced > 0 ? ["Unplaced"] : []),
      ].join(", ");
      throw new ShelfError({
        cause: null,
        label,
        status: 400,
        shouldBeCaptured: false,
        title: "Pick where the units come from",
        message: `"${title}" ${
          decision.locationId === null
            ? "has no unplaced units"
            : "is not placed at the location you picked"
        }. ${
          names
            ? `Pick one of: ${names}. Then check out again.`
            : "Check out again without picking a location."
        }`,
        additionalData: {
          organizationId,
          bookingAssetId: slice.id,
          assetId: slice.assetId,
          locationId: decision.locationId,
        },
      });
    }

    if (decision.action === "record") {
      const ids = sliceIdsBySource.get(decision.locationId) ?? [];
      ids.push(slice.id);
      sliceIdsBySource.set(decision.locationId, ids);
    }
  }

  // Grouped by location: `updateMany` takes one literal per statement, and a
  // check-out touches few distinct locations.
  for (const [sourceLocationId, ids] of sliceIdsBySource) {
    await tx.bookingAsset.updateMany({
      where: { id: { in: ids }, booking: { organizationId } },
      data: { sourceLocationId },
    });
  }

  return decisions;
}

/**
 * The pools on a booking that a check-out would ask about: standalone
 * quantity-tracked slices not sent out yet, whose pool sits at two or more
 * manual placements.
 *
 * Read-only; the dialogs use it to render one "From location" select per pool.
 *
 * For a client with the `booking-sources` capability, a slice with planned
 * sources (a converted group), and a LEGACY slice when adoption is on (it
 * converts at check-out), defaults to "as planned"
 * (`ALLOCATION_SOURCE_FORM_VALUE`): submitting the default dispatches by
 * allocation like no pick, so a source the plan avoids is never forced. A
 * LEGACY slice with adoption off defaults to the shelf (the most units left).
 * A converted slice also carries its plan as one line (`plannedSummary`, such
 * as "Demo Warehouse 8 · Unplaced 7"), so the select can say what "as
 * planned" sends out.
 *
 * A client without the capability has no "as planned" option, so its default
 * is always a real location: a converted slice's single pending LOCATION or
 * UNPLACED source when it has exactly one, otherwise the shelf default. Such a
 * client sends only the answers the operator changed, so an untouched default
 * is never submitted and the slice still dispatches by allocation.
 *
 * @param args.organizationId - Scopes every read
 * @param args.bookingId - The booking being checked out
 * @param args.sliceIds - Limit to these slices (a partial check-out's rows);
 *   omit for every slice still to go out
 * @returns One question per slice that needs an answer, in title order
 */
export async function getCheckoutSourceQuestions({
  organizationId,
  bookingId,
  sliceIds,
  clientSupportsSources = true,
  adoptionEnabled = BOOKING_SOURCES_ENABLED,
}: {
  organizationId: string;
  bookingId: string;
  sliceIds?: string[];
  /**
   * False for a phone build that does not announce the `booking-sources`
   * capability: it gets no question for a slice whose pending units are
   * split across sources (the server dispatches those by allocation), and
   * every default it gets is a location or Unplaced, never "as planned".
   */
  clientSupportsSources?: boolean;
  /**
   * Whether a LEGACY group converts at check-out; defaults to
   * `BOOKING_SOURCES_ENABLED`. Decides the default of a LEGACY slice.
   */
  adoptionEnabled?: boolean;
}): Promise<CheckoutSourceQuestion[]> {
  const slices = await db.bookingAsset.findMany({
    where: {
      bookingId,
      booking: { organizationId },
      assetKitId: null,
      checkedOutQuantity: 0,
      asset: { type: AssetType.QUANTITY_TRACKED, organizationId },
      ...(sliceIds ? { id: { in: sliceIds } } : {}),
    },
    select: {
      id: true,
      assetId: true,
      quantity: true,
      sourceAllocation: true,
    },
  });
  if (slices.length === 0) return [];

  // Converted slices already have sources planned. Their rows name the plan
  // behind "as planned"; an older phone is asked nothing about a split plan,
  // and a single pending source is its default.
  const convertedIds = slices
    .filter(
      (slice) =>
        slice.sourceAllocation === "AUTO" || slice.sourceAllocation === "MANUAL"
    )
    .map((slice) => slice.id);
  const [snapshots, rows] = await Promise.all([
    loadPoolSourceSnapshots(db, {
      organizationId,
      assetIds: slices.map((slice) => slice.assetId),
    }),
    convertedIds.length === 0
      ? Promise.resolve([])
      : db.bookingAssetSource.findMany({
          where: {
            organizationId,
            bookingAssetId: { in: convertedIds },
            kind: { in: ["LOCATION", "UNPLACED"] },
          },
          select: {
            bookingAssetId: true,
            kind: true,
            locationId: true,
            quantity: true,
            outQuantity: true,
            releasedQuantity: true,
          },
        }),
  ]);
  const convertedSet = new Set(convertedIds);
  /** The converted slices' rows, as one array type whichever branch ran. */
  const sourceRows: Array<(typeof rows)[number]> = rows;
  const locationNames = clientSupportsSources
    ? await planLocationNames({ organizationId, rows: sourceRows, snapshots })
    : new Map<string, string>();

  const questions: CheckoutSourceQuestion[] = [];
  for (const slice of slices) {
    const snapshot = snapshots.get(slice.assetId);
    if (!snapshot || !poolAsksForSource(snapshot)) continue;
    const fromAllocation = convertedSet.has(slice.id);
    let defaultLocationId: string | null;
    if (!clientSupportsSources) {
      const pendingSources = fromAllocation
        ? sourceRows.filter(
            (row) =>
              row.bookingAssetId === slice.id &&
              row.quantity - row.releasedQuantity - row.outQuantity > 0
          )
        : [];
      // A split plan: an older phone cannot answer for it, so it is not asked
      // and the slice goes out by its plan.
      if (pendingSources.length > 1) continue;
      // An older phone lists only locations and Unplaced, so it gets a real
      // one: the plan's single pending source (null for UNPLACED), else the
      // shelf default. It sends only rows the operator changed, so this
      // display default never reaches the server as a pick.
      defaultLocationId =
        pendingSources.length === 1
          ? pendingSources[0].locationId
          : defaultSourceLocationId(snapshot);
    } else {
      // "As planned" whenever the slice dispatches through its source rows
      // (converted, or converting now): a shelf default submitted unchanged
      // would read as the operator's choice and move the plan into it.
      defaultLocationId =
        fromAllocation || adoptionEnabled
          ? ALLOCATION_SOURCE_FORM_VALUE
          : defaultSourceLocationId(snapshot);
    }
    // What "as planned" sends out, for the select to name. Only a capable
    // client offers that option, and only a converted slice has a plan.
    const plannedSummary =
      clientSupportsSources && fromAllocation
        ? formatSourceSummary(
            describeBookingSources({
              rows: sourceRows.filter((row) => row.bookingAssetId === slice.id),
              locationNames,
              shortSourceKeys: new Set(),
            })
          )
        : "";
    questions.push({
      sliceId: slice.id,
      assetId: slice.assetId,
      title: snapshot.title,
      unitOfMeasure: snapshot.unitOfMeasure,
      quantity: slice.quantity,
      placements: snapshot.placements,
      unplaced: snapshot.unplaced,
      defaultLocationId,
      fromAllocation,
      ...(plannedSummary ? { plannedSummary } : {}),
    });
  }

  return questions.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Names of the locations a set of planned source rows points at. Placements
 * already read for the pools supply most of them; a row at a location the
 * pool is no longer placed at (its placement was removed while units stay
 * held there) is looked up, scoped to the workspace.
 *
 * @param args.organizationId - Scopes the lookup
 * @param args.rows - The planned rows
 * @param args.snapshots - The pools' placements, keyed by asset id
 * @returns Location id to name; one query only when a name is missing
 */
async function planLocationNames({
  organizationId,
  rows,
  snapshots,
}: {
  organizationId: string;
  rows: ReadonlyArray<{ locationId: string | null }>;
  snapshots: ReadonlyMap<string, Pick<PoolSourceSnapshot, "placements">>;
}): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const snapshot of snapshots.values()) {
    for (const placement of snapshot.placements) {
      names.set(placement.locationId, placement.name);
    }
  }
  const missing = [
    ...new Set(
      rows.flatMap((row) =>
        row.locationId && !names.has(row.locationId) ? [row.locationId] : []
      )
    ),
  ];
  if (missing.length === 0) return names;
  const locations = await db.location.findMany({
    where: { id: { in: missing }, organizationId },
    select: { id: true, name: true },
  });
  for (const location of locations) names.set(location.id, location.name);
  return names;
}

/** One slice a check-out sends units out of, as the writers know it. */
export type CheckoutDeparture = {
  /** `BookingAsset.id`. */
  sliceId: string;
  assetId: string;
  /** Units leaving now; the writer adds the same to `checkedOutQuantity`. */
  units: number;
};

/**
 * Records where a check-out's units leave from, for every departing slice,
 * inside the check-out's transaction and BEFORE the writer adds to
 * `BookingAsset.checkedOutQuantity`.
 *
 * Slices of quantity-tracked pools go through {@link dispatchUnits}: a
 * converted group (or a LEGACY group that converts now) dispatches from its
 * source rows, by allocation or from the source picked in `submission`, with
 * the short, re-claim and physical-now refusals that implies. Every other
 * departing slice (a group that stays LEGACY, an INDIVIDUAL asset) is
 * recorded the LEGACY way by {@link recordCheckoutSourceLocations}.
 *
 * The caller must already hold every pool asset in `poolAssetIds` under its
 * first sorted asset lock: the facade re-takes those rows only.
 *
 * @param tx - The check-out's transaction client
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking being checked out
 * @param args.departures - Every slice leaving in this call, with its units
 * @param args.poolAssetIds - The quantity-tracked assets among them
 * @param args.submission - Picks from the dialog or the phone, keyed by slice
 *   or asset id
 * @param args.window - The booking window the check-out commits
 * @param args.clientSupportsSources - False for a phone build without the
 *   `booking-sources` capability; defaults to true
 * @param args.adoptionEnabled - Whether a LEGACY group may convert here;
 *   defaults to `BOOKING_SOURCES_ENABLED` (false keeps LEGACY groups as they are)
 * @returns The sources each converted slice dispatched from
 * @throws {ShelfError} 400 from either path; the transaction rolls back
 */
export async function dispatchCheckoutSources(
  tx: SourceTxClient & BookingSourcesTx,
  {
    organizationId,
    bookingId,
    departures,
    poolAssetIds,
    submission = NO_SOURCE_SUBMISSION,
    window,
    clientSupportsSources = true,
    adoptionEnabled,
  }: {
    organizationId: string;
    bookingId: string;
    departures: CheckoutDeparture[];
    poolAssetIds: ReadonlySet<string>;
    submission?: SourceLocationSubmission;
    window: { from: Date; to: Date };
    clientSupportsSources?: boolean;
    adoptionEnabled?: boolean;
  }
): Promise<DispatchedSlice[]> {
  const leaving = departures.filter((d) => d.units > 0);
  const pools = leaving.filter((d) => poolAssetIds.has(d.assetId));
  const result =
    pools.length === 0
      ? { dispatched: [], legacySliceIds: [] }
      : await dispatchUnits(tx, {
          organizationId,
          bookingId,
          window,
          clientSupportsSources,
          ...(adoptionEnabled === undefined ? {} : { adoptionEnabled }),
          picks: pools.map((d) => {
            const submitted = submittedSourceForSlice(submission, {
              id: d.sliceId,
              assetId: d.assetId,
            });
            return submitted
              ? {
                  sliceId: d.sliceId,
                  units: d.units,
                  fromLocationId: submitted.locationId,
                }
              : { sliceId: d.sliceId, units: d.units };
          }),
        });

  const legacy = new Set(result.legacySliceIds);
  await recordCheckoutSourceLocations(tx, {
    organizationId,
    sliceIds: leaving
      .filter((d) => !poolAssetIds.has(d.assetId) || legacy.has(d.sliceId))
      .map((d) => d.sliceId),
    submission,
  });
  return result.dispatched;
}

/**
 * What a quick check-out that asked no "From location" question says when the
 * booking has one to ask. The bookings list and the bulk check-out both send
 * the operator to the booking page, where the dialog asks it.
 */
export const CHECKOUT_NEEDS_SOURCE_CHOICE_MESSAGE =
  "This booking needs a from-location choice. Open the booking to check it out.";

/**
 * Refuses a check-out made from a surface that cannot ask the "From location"
 * question when the booking has one to ask for a LEGACY slice. A slice whose
 * sources are already planned dispatches by that plan, so it never refuses.
 *
 * The booking page's dialog renders one select per question, so a check-out
 * from there has always had the chance to answer. A row on the bookings list
 * has not: letting it through would send every multi-placed pool out from the
 * default location without anyone choosing, so the row is refused instead and
 * the operator opens the booking.
 *
 * @param args.organizationId - Scopes the read
 * @param args.bookingId - The booking being checked out
 * @throws {ShelfError} 400 when at least one LEGACY pool slice still to go out
 *   sits at two or more placements
 */
export async function assertNoCheckoutSourceQuestions({
  organizationId,
  bookingId,
}: {
  organizationId: string;
  bookingId: string;
}): Promise<void> {
  // A slice with planned sources dispatches by that plan when nobody picks,
  // so only LEGACY questions need the booking page.
  const questions = (
    await getCheckoutSourceQuestions({ organizationId, bookingId })
  ).filter((question) => !question.fromAllocation);
  if (questions.length === 0) return;

  throw new ShelfError({
    cause: null,
    title: "Open the booking to check it out",
    message: CHECKOUT_NEEDS_SOURCE_CHOICE_MESSAGE,
    additionalData: {
      organizationId,
      bookingId,
      sliceIds: questions.map((question) => question.sliceId),
    },
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/** A slice's recorded source, as the booking surfaces print it. */
export type SliceSourceLocation = { id: string; name: string };

/**
 * Look up the names of the locations booking slices recorded as their source.
 *
 * `BookingAsset.sourceLocationId` is a plain column (no Prisma relation), so
 * readers resolve the names here in one org-scoped query rather than through
 * the booking include.
 *
 * @param args.organizationId - Scopes the lookup; a foreign id reads as absent
 * @param args.locationIds - Recorded source ids; `null`s are skipped
 * @returns Each found location keyed by id
 */
export async function loadSliceSourceLocations({
  organizationId,
  locationIds,
}: {
  organizationId: string;
  locationIds: Array<string | null | undefined>;
}): Promise<Map<string, SliceSourceLocation>> {
  const ids = [
    ...new Set(locationIds.filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return new Map();
  const locations = await db.location.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, name: true },
  });
  return new Map(locations.map((location) => [location.id, location]));
}

/**
 * The pools, among `assetIds`, that sit at two or more manual placements: the
 * ones whose booking rows say where their units left from. A pool at one
 * placement, or none, shows nothing new.
 *
 * @param args.organizationId - Scopes the read
 * @param args.assetIds - Quantity-tracked assets on a booking
 * @returns The ids of the multi-placed pools
 */
export async function loadMultiPlacedPoolIds({
  organizationId,
  assetIds,
}: {
  organizationId: string;
  assetIds: string[];
}): Promise<Set<string>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Set();
  const placements = await db.assetLocation.findMany({
    where: { assetId: { in: ids }, organizationId, assetKitId: null },
    select: { assetId: true },
  });
  const countByAsset = new Map<string, number>();
  for (const { assetId } of placements) {
    countByAsset.set(assetId, (countByAsset.get(assetId) ?? 0) + 1);
  }
  return new Set(
    [...countByAsset].filter(([, count]) => count >= 2).map(([id]) => id)
  );
}
