/**
 * Buckets each scanned item against a booking's outstanding model
 * reservations.
 *
 * This is the client's mirror of what the server writes: INDIVIDUAL units
 * only, a kit member counted once, an asset already on the booking counted
 * only when its row still carries no reservation stamp, and never more units
 * than a model has left. Both booking scanners read it, because a second copy
 * drifts from the write and shows an operator a fulfilment that never happens.
 *
 * Pure, so a route may import it and so the rules can be tested without
 * mounting a drawer.
 *
 * @see {@link file://./service.server.ts} for the write these rules mirror.
 * @see {@link file://./claimable.ts} for who may claim at all.
 */
import { AssetType } from "@prisma/client";
import type { ExpectedModelRequest, ScanListItems } from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";

/**
 * Shape of a scanned asset row after bucket classification. `qrId`
 * preserves the insertion order from `scannedItemsAtom` so the drawer
 * feels stable as scans arrive.
 */
export type ScannedAssetRow = {
  qrId: string;
  /** Real `AssetFromQr` payload when resolved, undefined while loading. */
  asset: AssetFromQr | undefined;
  /**
   * - `"matched"`    : fills a pending model row (counts toward progress)
   * - `"unmatched"`  : off-model OR over-scan OR still loading (warning copy)
   * - `"duplicate"`  : asset is already on the booking via `alreadyIncluded`
   *                    and the whole booking goes out anyway; the scan is a
   *                    no-op and is not submitted.
   * - `"viaKit"`     : the asset's own kit was scanned too, so it arrives as
   *                    part of that kit rather than as a loose unit
   * - `"included"`   : asset is already on the booking and submit sends out
   *                    only scanned items; the scan checks this item out.
   * - `"claimed"`    : asset is already on the booking but its row answered no
   *                    reservation, and this scan makes it answer one. Counts
   *                    toward progress and is submitted.
   */
  bucket:
    | "matched"
    | "unmatched"
    | "duplicate"
    | "included"
    | "viaKit"
    | "claimed";
  /** Name of the scanned kit this asset arrives with. `viaKit` rows only. */
  viaKitName?: string;
  /** Model this row answered. `claimed` rows only. */
  claimedModelName?: string;
};

/**
 * Shape of a scanned kit row after member matching. `qrId` preserves the
 * insertion order from `scannedItemsAtom`, as for asset rows.
 *
 * A kit has no bucket of its own: it always goes on the booking and always
 * goes out with this check-out. What varies is how much of the booking's
 * outstanding reservation it settles, which `matchedMemberCount` carries.
 */
export type ScannedKitRow = {
  qrId: string;
  /** Real `KitFromQr` payload once resolved, undefined while loading. */
  kit: KitFromQr | undefined;
  /** Members of this kit that assign an outstanding reserved unit. */
  matchedMemberCount: number;
};

/**
 * Input to {@link matchScansToModelRequests}.
 *
 * Every field is a value a booking scanner already holds in its own atoms and
 * derived memos, passed in explicitly so the matcher has no dependency on
 * Jotai or React and both booking scanners can share it.
 */
export type ScanMatchingInput = {
  /** Scanned items in insertion order, keyed by qrId, as `scannedItemsAtom` holds them. */
  items: ScanListItems;
  /** Outstanding `BookingModelRequest` entries this booking still needs filled. */
  expectedModelRequests: ExpectedModelRequest[];
  /** Ids of the concrete `BookingAsset`s already on the booking. */
  alreadyIncludedIds: Set<string>;
  /** Already-included asset ids whose row still answers no reservation. */
  claimableIncludedIds: Set<string>;
  /**
   * `true` when submit sends out only scanned items (explicit check-out, or a
   * booking already underway), so an already-included scan that answers no
   * reservation still does something: it checks that item out.
   */
  checksOutScannedOnly: boolean;
};

/**
 * Result of {@link matchScansToModelRequests}: the classified rows, and the
 * per-model tally that drives progress strips.
 */
export type ScanMatchingResult = {
  /** One row per scanned asset item, classified into a bucket. */
  rows: ScannedAssetRow[];
  /** One row per scanned kit item, with its member match count. */
  kitRows: ScannedKitRow[];
  /** assetModelId to units matched against that model's remaining quota so far. */
  matchedCountByModel: Map<string, number>;
};

/**
 * Classifies scanned items into asset rows (matched / unmatched / duplicate /
 * included / claimed / viaKit) and kit rows, and tallies what each assigns
 * against the outstanding reservations.
 *
 * Items that have not resolved yet (`data === undefined`) carry no type, so
 * they flow through the asset path and land in "unmatched". That is safe:
 * once the fetch resolves and the caller re-runs this with the updated
 * `items`, the row lands where it belongs, including as a kit row.
 *
 * @param input - See {@link ScanMatchingInput}.
 * @returns The classified rows and the per-model match tally. See
 *   {@link ScanMatchingResult}.
 */
export function matchScansToModelRequests(
  input: ScanMatchingInput
): ScanMatchingResult {
  const {
    items,
    expectedModelRequests,
    alreadyIncludedIds,
    claimableIncludedIds,
    checksOutScannedOnly,
  } = input;

  const expectedByModelId = new Map(
    expectedModelRequests.map((expected) => [expected.assetModelId, expected])
  );

  // assetModelId → number of units consumed against that model's
  // `remaining` quota so far in this iteration. "Remaining" already
  // accounts for pre-fulfilled units: a model with `quantity: 3,
  // fulfilledQuantity: 2` ships `remaining: 1`, so only one unit can
  // match before we flip to "unmatched" (over-scan).
  const matchedCountByModel = new Map<string, number>();
  const rows: ScannedAssetRow[] = [];
  const kitRows: ScannedKitRow[] = [];

  /**
   * Members of the kits in this scan, and which kit each arrives with.
   *
   * A member whose kit is also scanned goes on the booking as part of that
   * kit: the server drops it from the loose bucket, because the two rows
   * would otherwise book one physical unit twice. So the kit owns the
   * assignment and the asset's own row reports what it is rather than
   * claiming a unit of its own; crediting both would count one camera twice.
   *
   * Resolved up-front rather than in scan order, so the attribution does not
   * depend on which QR the operator reached first.
   */
  const kitNameByMemberId = new Map<string, string>();
  for (const item of Object.values(items)) {
    if (!item || item.type !== "kit") continue;
    const kit = item.data as KitFromQr | undefined;
    if (!kit) continue;
    for (const assetKit of kit.assetKits ?? []) {
      const member = assetKit.asset;
      if (!member || member.type !== AssetType.INDIVIDUAL) continue;
      if (kitNameByMemberId.has(member.id)) continue;
      kitNameByMemberId.set(member.id, kit.name);
    }
  }

  // Members that have already assigned a unit via an earlier kit row. Two
  // kits can share a member; it settles one reservation, not two.
  const assignedKitMemberIds = new Set<string>();

  for (const [qrId, item] of Object.entries(items)) {
    if (!item) continue;

    if (item.type === "kit") {
      const kit = (item.data ?? undefined) as KitFromQr | undefined;
      let matchedMemberCount = 0;
      // One `AssetKit` row per member, but guard the count against a
      // payload listing a member twice.
      const seenMemberIds = new Set<string>();

      for (const assetKit of kit?.assetKits ?? []) {
        const member = assetKit.asset;
        if (!member || seenMemberIds.has(member.id)) continue;
        seenMemberIds.add(member.id);

        // Only whole assets settle a reservation: a QUANTITY_TRACKED
        // member contributes a slice of its pool, which is not the unit a
        // `BookingModelRequest` reserves.
        if (member.type !== AssetType.INDIVIDUAL) continue;
        if (
          assignedKitMemberIds.has(member.id) ||
          alreadyIncludedIds.has(member.id)
        ) {
          continue;
        }

        const expected = member.assetModelId
          ? expectedByModelId.get(member.assetModelId)
          : undefined;
        if (!expected) continue;

        const consumed = matchedCountByModel.get(expected.assetModelId) ?? 0;
        if (consumed >= expected.remaining) continue;

        matchedCountByModel.set(expected.assetModelId, consumed + 1);
        assignedKitMemberIds.add(member.id);
        matchedMemberCount += 1;
      }

      // Members that match nothing are not an error: the kit still goes
      // on the booking and still goes out.
      kitRows.push({ qrId, kit, matchedMemberCount });
      continue;
    }

    const asset = (item.data ?? undefined) as AssetFromQr | undefined;

    // An asset already on the booking can still answer a reservation, if its
    // row never did. That is the ordinary state for a unit added before the
    // reservation existed, or before its model matched one, and scanning it
    // is how the operator says so. It counts toward progress exactly once,
    // bounded by the same outstanding count a fresh scan is.
    if (asset && alreadyIncludedIds.has(asset.id)) {
      const includedModelId = asset.assetModelId ?? null;
      const includedExpected = includedModelId
        ? expectedByModelId.get(includedModelId)
        : undefined;
      const consumed = includedExpected
        ? matchedCountByModel.get(includedExpected.assetModelId) ?? 0
        : 0;

      if (
        includedExpected &&
        claimableIncludedIds.has(asset.id) &&
        consumed < includedExpected.remaining
      ) {
        matchedCountByModel.set(includedExpected.assetModelId, consumed + 1);
        rows.push({
          qrId,
          asset,
          bucket: "claimed",
          claimedModelName: includedExpected.assetModelName,
        });
        continue;
      }

      // Answers nothing: re-scanning it would fill the progress bar with
      // nothing new. Whether the scan does anything depends on what submit
      // sends out: when only scanned items leave, scanning it is how it gets
      // checked out.
      rows.push({
        qrId,
        asset,
        bucket: checksOutScannedOnly ? "included" : "duplicate",
      });
      continue;
    }

    // Its kit is in this scan, so the kit row above is what assigns it.
    const viaKitName = asset ? kitNameByMemberId.get(asset.id) : undefined;
    if (asset && viaKitName) {
      rows.push({ qrId, asset, bucket: "viaKit", viaKitName });
      continue;
    }

    const modelId = asset?.assetModelId ?? null;
    const expected = modelId ? expectedByModelId.get(modelId) : undefined;

    // Whole assets only, the same rule the kit-member pass applies above and
    // the one the server enforces: a quantity-tracked scan contributes a
    // slice of its pool, which is not the unit a `BookingModelRequest`
    // reserves, so it falls through to unmatched. Without it the strip fills
    // on a scan the write declines and the booking reads ready to leave.
    if (expected && asset?.type === AssetType.INDIVIDUAL) {
      const consumed = matchedCountByModel.get(expected.assetModelId) ?? 0;
      // Only scans within the STILL-OUTSTANDING count match. If the
      // request is already partially pre-fulfilled (2 of 3 scanned
      // earlier), only one more scan can match; subsequent scans
      // flip to unmatched/over-scan.
      if (consumed < expected.remaining) {
        matchedCountByModel.set(expected.assetModelId, consumed + 1);
        rows.push({ qrId, asset, bucket: "matched" });
        continue;
      }
    }

    // Either (a) the asset resolved but its model isn't expected,
    // (b) it's an over-scan of an expected model, or (c) the asset
    // hasn't resolved yet. In all cases we park it in "unmatched"
    // so `GenericItemRow` still mounts + fires the fetch.
    rows.push({ qrId, asset, bucket: "unmatched" });
  }

  return { rows, kitRows, matchedCountByModel };
}
