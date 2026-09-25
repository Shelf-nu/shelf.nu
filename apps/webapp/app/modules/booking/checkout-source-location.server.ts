/**
 * Record which location a booking slice's units leave from (DB side).
 *
 * Every check-out writer calls {@link recordCheckoutSourceLocations} inside its
 * own transaction, right before it adds to `BookingAsset.checkedOutQuantity`.
 * The pure rule lives in {@link file://./checkout-source-location.ts}; this
 * module only reads what the rule needs and writes the answer.
 *
 * The check-out dialogs read the same data through
 * {@link getCheckoutSourceQuestions}, so the option the dialog pre-selects is
 * the answer the server records when nothing is submitted.
 *
 * @see {@link file://./checkout-source-location.ts}
 * @see {@link file://./service.server.ts} the check-out writers
 */

import { AssetType } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ExtendedPrismaClient } from "~/database/db.server";
import type { CustodySourceState } from "~/modules/asset/custody-source";
import { unitsLeftAtSource } from "~/modules/asset/custody-source";
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
  defaultSourceLocationId,
  NO_SOURCE_SUBMISSION,
  poolAsksForSource,
  resolveSliceSource,
  submittedSourceForSlice,
} from "./checkout-source-location";

const label: ErrorLabel = "Booking";

/**
 * The client surface this module reads and writes through. A `Pick` of the
 * extended client, so both the root `db` and an interactive transaction
 * client (which is the same client minus its `$` methods) satisfy it.
 */
type SourceTxClient = Pick<
  ExtendedPrismaClient,
  "asset" | "assetLocation" | "assetKit" | "bookingAsset" | "custody" | "kit"
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

  const [assets, placements, operatorCustody] = await Promise.all([
    tx.asset.findMany({
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
      select: { assetId: true, locationId: true, quantity: true },
    }),
  ]);

  const placementsByAsset = new Map<string, SourcePlacement[]>();
  for (const placement of placements) {
    const list = placementsByAsset.get(placement.assetId) ?? [];
    list.push({
      locationId: placement.locationId,
      name: placement.location.name,
      placed: placement.quantity,
      left: placement.quantity,
    });
    placementsByAsset.set(placement.assetId, list);
  }

  for (const asset of assets) {
    const assetPlacements = placementsByAsset.get(asset.id) ?? [];
    const placedSum = assetPlacements.reduce((sum, p) => sum + p.placed, 0);
    // Units left = placed minus custody taken from there: the one definition
    // custody's own "From location" uses, so both questions agree.
    const state: CustodySourceState = {
      total: asset.quantity ?? 0,
      placements: assetPlacements.map((p) => ({
        locationId: p.locationId,
        quantity: p.placed,
      })),
      operatorCustody: operatorCustody.filter((c) => c.assetId === asset.id),
    };
    for (const placement of assetPlacements) {
      placement.left = unitsLeftAtSource(state, placement.locationId);
    }
    snapshots.set(asset.id, {
      assetId: asset.id,
      title: asset.title,
      unitOfMeasure: asset.unitOfMeasure,
      placements: assetPlacements,
      unplaced: Math.max(0, (asset.quantity ?? 0) - placedSum),
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
}: {
  organizationId: string;
  bookingId: string;
  sliceIds?: string[];
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
    select: { id: true, assetId: true, quantity: true },
  });
  if (slices.length === 0) return [];

  const snapshots = await loadPoolSourceSnapshots(db, {
    organizationId,
    assetIds: slices.map((slice) => slice.assetId),
  });

  const questions: CheckoutSourceQuestion[] = [];
  for (const slice of slices) {
    const snapshot = snapshots.get(slice.assetId);
    if (!snapshot || !poolAsksForSource(snapshot)) continue;
    questions.push({
      sliceId: slice.id,
      assetId: slice.assetId,
      title: snapshot.title,
      unitOfMeasure: snapshot.unitOfMeasure,
      quantity: slice.quantity,
      placements: snapshot.placements,
      unplaced: snapshot.unplaced,
      defaultLocationId: defaultSourceLocationId(snapshot),
    });
  }

  return questions.sort((a, b) => a.title.localeCompare(b.title));
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
