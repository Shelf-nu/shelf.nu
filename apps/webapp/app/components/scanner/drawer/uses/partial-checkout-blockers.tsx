/**
 * Blocker list for the partial check-out scanner drawer.
 *
 * A blocker is the row's answer to "why can this not go out on this booking".
 * The drawer component is impractical to mount in a test (its import graph
 * reaches canvas), so the derivation lives here as a pure function of the
 * scanned items and the booking context, and every blocker carries a stable
 * `id` that `partial-checkout-blockers.test.tsx` asserts on. Adding a blocker
 * means adding a case there.
 *
 * @see {@link file://./../blockers-factory.tsx} renders what this returns
 * @see {@link file://./partial-checkout-drawer.tsx}
 * @see {@link file://./custody-blockers.tsx} the same shape for the custody drawers
 */

import { AssetStatus } from "@prisma/client";
import type { AssetType } from "@prisma/client";
import type { ScanListItems } from "~/atoms/qr-scanner";
import { isQuantityTracked } from "~/modules/asset/utils";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import type { BlockerConfig } from "../blockers-factory";

/** Minimal asset shape the type-aware "fully checked out" predicate needs. */
export type FullyCheckedOutAsset = {
  id: string;
  status: AssetStatus;
  type?: AssetType | string | null;
};

/**
 * Decide whether an asset is fully checked out on this booking, i.e. has
 * zero units left to check out and should be treated as a blocker / hide
 * the qty input.
 *
 * - INDIVIDUAL: binary. "Fully out" iff live status is `CHECKED_OUT` OR
 *   the asset appears in a prior `PartialBookingCheckout` record.
 * - QUANTITY_TRACKED: gated on the loader-computed
 *   `remainingToCheckOutByAsset` (sum of remaining units across every
 *   slice on this booking). A partial top-off (e.g. 5 of 50 already out,
 *   45 still bookable) is NOT "fully out": the asset stays scannable
 *   and the qty input renders with the remaining units pre-filled.
 *
 * @param asset Asset (id + live status + optional `type`)
 * @param remainingByAssetId Loader-supplied asset-level remaining map (QT only)
 * @param checkedOutIdSet Asset ids recorded in prior partial-checkouts
 * @returns `true` when no more units of the asset can be checked out
 */
export function isAssetFullyCheckedOut(
  asset: FullyCheckedOutAsset,
  remainingByAssetId: Record<string, number>,
  checkedOutIdSet: Set<string>
): boolean {
  if (asset.type === "QUANTITY_TRACKED") {
    // Use the loader-supplied remaining only when an entry exists for
    // this asset. Absent entry = legacy/test path: fall back to the
    // binary gate so QT assets without a top-off map don't get flagged
    // "fully out" simply because the asset is missing from the map.
    if (asset.id in remainingByAssetId) {
      return (remainingByAssetId[asset.id] ?? 0) <= 0;
    }
  }
  return (
    asset.status === AssetStatus.CHECKED_OUT || checkedOutIdSet.has(asset.id)
  );
}

/** What the drawer hands in to build its blocker list. */
export type PartialCheckoutBlockerArgs = {
  /** The scanned rows, keyed by the code that resolved them. */
  items: ScanListItems;
  /** Unique asset ids booked on this booking, across every slice. */
  bookingAssetIds: Set<string>;
  /** Units still to check out per QUANTITY_TRACKED asset on this booking. */
  remainingByAssetId: Record<string, number>;
  /** Asset ids recorded in prior partial check-outs of this booking. */
  alreadyCheckedOut: Set<string>;
  /**
   * Kits on this booking that another booking holds for an overlapping window,
   * or that are still out on an overdue one. From `findKitsBookedElsewhere`,
   * the same lookup `partialCheckoutBooking` refuses on.
   */
  kitsBookedElsewhere: Set<string>;
  /** The assets this booking took from those kits. */
  assetsInKitsBookedElsewhere: Set<string>;
  /** Drops rows by ASSET id. */
  removeAssetsFromList: (assetIds: string[]) => void;
  /** Drops rows by the CODE that scanned them, which is how kits are keyed. */
  removeItemsFromList: (qrIds: string[]) => void;
};

/**
 * A built list. "Resolve all" is derived from it by `createBlockers` (every
 * shown blocker's `onResolve`), so the builder does not supply one.
 */
export type PartialCheckoutBlockers = {
  blockerConfigs: BlockerConfig[];
};

/** Scanned rows that resolved to an asset. */
function assetsOf(items: ScanListItems): AssetFromQr[] {
  return Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);
}

/** Scanned rows that resolved to a kit. */
function kitsOf(items: ScanListItems): KitFromQr[] {
  return Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);
}

/** Codes whose row is of `type` and whose data id is in `ids`. */
function qrIdsFor(
  items: ScanListItems,
  type: "asset" | "kit",
  ids: string[]
): string[] {
  return Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== type) return false;
      return ids.includes((item.data as { id?: string } | undefined)?.id ?? "");
    })
    .map(([qrId]) => qrId);
}

/**
 * Blockers for the partial check-out drawer.
 *
 * Kit members are deliberately not blocked for being part of a kit: a partial
 * check-out may send individual kit assets out on their own. A kit another
 * booking holds is blocked, and so is a member of it scanned on its own: the
 * submit sends every slice of a scanned asset, the kit slice included, and
 * `partialCheckoutBooking` refuses the kit either way. The scanned payload does
 * not carry other bookings, so the loader resolves those kits.
 *
 * A kit with a custodian is blocked whatever its members are. The kit is one
 * unit: a person holding it cannot also hand it to a borrower, and that holds
 * for a kit of only quantity-tracked members, whose `Asset.status` says
 * nothing about the kit.
 */
export function buildPartialCheckoutBlockers({
  items,
  bookingAssetIds,
  remainingByAssetId,
  alreadyCheckedOut,
  kitsBookedElsewhere,
  assetsInKitsBookedElsewhere,
  removeAssetsFromList,
  removeItemsFromList,
}: PartialCheckoutBlockerArgs): PartialCheckoutBlockers {
  const assets = assetsOf(items);
  const kits = kitsOf(items);
  const errorQrIds = Object.entries(items)
    .filter(([, item]) => !!item?.error)
    .map(([qrId]) => qrId);

  const assetsNotInBookingIds = assets
    .filter((asset) => !bookingAssetIds.has(asset.id))
    .map((a) => a.id);

  // Type-aware via `isAssetFullyCheckedOut`: a QT asset with a partial top-off
  // left does NOT land here, it must stay scannable.
  const alreadyCheckedOutAssets = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) &&
        isAssetFullyCheckedOut(asset, remainingByAssetId, alreadyCheckedOut)
    )
    .map((a) => a.id);
  const qrIdsOfAlreadyCheckedOutAssets = qrIdsFor(
    items,
    "asset",
    alreadyCheckedOutAssets
  );

  // Whole-asset statement, so INDIVIDUAL only. A quantity-tracked pool reads
  // IN_CUSTODY while a single unit is held and the rest is free stock, and
  // `partialCheckoutBooking` exempts it the same way: what a pool may send out
  // is its units left on this booking, which `assets-already-checked-out`
  // judges instead.
  const assetsInCustody = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) &&
        !isQuantityTracked(asset) &&
        asset.status === AssetStatus.IN_CUSTODY
    )
    .map((a) => a.id);
  const qrIdsOfAssetsInCustody = qrIdsFor(items, "asset", assetsInCustody);

  // A kit is "in this booking" when any of its members is booked.
  const kitsNotInBooking = kits
    .filter(
      (kit) => !kit.assetKits.some((ak) => bookingAssetIds.has(ak.asset.id))
    )
    .map((kit) => kit.id);
  const qrIdsOfKitsNotInBooking = qrIdsFor(items, "kit", kitsNotInBooking);

  // Every in-booking member has zero units left to check out. Type-aware so a
  // kit holding a QT asset with remaining units can still be topped off.
  const alreadyCheckedOutKits = kits
    .filter((kit) => {
      const kitAssetsInBooking = kit.assetKits
        .map((ak) => ak.asset)
        .filter((asset) => bookingAssetIds.has(asset.id));
      return (
        kitAssetsInBooking.length > 0 &&
        kitAssetsInBooking.every((asset) =>
          isAssetFullyCheckedOut(asset, remainingByAssetId, alreadyCheckedOut)
        )
      );
    })
    .map((kit) => kit.id);
  const qrIdsOfAlreadyCheckedOutKits = qrIdsFor(
    items,
    "kit",
    alreadyCheckedOutKits
  );

  // Judged on the kit's own custody row, not on `Kit.status` or its members.
  // Kits outside the booking are left to `kits-not-in-booking`.
  const kitsInCustody = kits
    .filter((kit) => !!kit.custody && !kitsNotInBooking.includes(kit.id))
    .map((kit) => kit.id);
  const qrIdsOfKitsInCustody = qrIdsFor(items, "kit", kitsInCustody);

  // Kits outside the booking are left to `kits-not-in-booking`.
  const kitsHeldElsewhere = kits
    .filter(
      (kit) =>
        kitsBookedElsewhere.has(kit.id) && !kitsNotInBooking.includes(kit.id)
    )
    .map((kit) => kit.id);
  const qrIdsOfKitsHeldElsewhere = qrIdsFor(items, "kit", kitsHeldElsewhere);

  // Assets that are redundant because their kit is also scanned.
  const redundantAssetIds: string[] = [];
  const qrIdsOfRedundantAssets: string[] = [];
  assets.forEach((asset) => {
    // Kit membership lives on `Asset.assetKits[]`. The first pivot row's kitId
    // carries the 1-asset-1-kit semantics this redundancy check expresses.
    const assetKitId = asset.assetKits?.[0]?.kitId;
    if (!assetKitId) return;

    const kitIsScanned = kits.some((kit) => kit.id === assetKitId);
    if (kitIsScanned && bookingAssetIds.has(asset.id)) {
      redundantAssetIds.push(asset.id);
      const assetQrId = Object.entries(items).find(
        ([, item]) =>
          item?.type === "asset" &&
          (item.data as { id?: string } | undefined)?.id === asset.id
      )?.[0];
      if (assetQrId) {
        qrIdsOfRedundantAssets.push(assetQrId);
      }
    }
  });

  // A member scanned alongside its kit is already reported as redundant, and
  // the kit carries the conflict, so it is not counted twice.
  const assetsHeldElsewhere = assets
    .filter(
      (asset) =>
        assetsInKitsBookedElsewhere.has(asset.id) &&
        !redundantAssetIds.includes(asset.id)
    )
    .map((asset) => asset.id);
  const qrIdsOfAssetsHeldElsewhere = qrIdsFor(
    items,
    "asset",
    assetsHeldElsewhere
  );

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "assets-not-in-booking",
      condition: assetsNotInBookingIds.length > 0,
      count: assetsNotInBookingIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> not
          part of this booking.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsNotInBookingIds),
    },
    {
      id: "assets-already-checked-out",
      condition: alreadyCheckedOutAssets.length > 0,
      count: alreadyCheckedOutAssets.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> already
          checked out for this booking.
        </>
      ),
      description: "These assets cannot be checked out again",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedOutAssets),
    },
    {
      id: "assets-in-custody",
      condition: assetsInCustody.length > 0,
      count: assetsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> currently
          in custody. Release custody first.
        </>
      ),
      description: "Release custody before checking these assets out",
      onResolve: () => removeItemsFromList(qrIdsOfAssetsInCustody),
    },
    {
      id: "kits-already-checked-out",
      condition: alreadyCheckedOutKits.length > 0,
      count: alreadyCheckedOutKits.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s have" : " has"}`}</strong>{" "}
          already been checked out for this booking.
        </>
      ),
      description: "All assets from these kits have already been checked out",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedOutKits),
    },
    {
      id: "kit-in-custody",
      condition: kitsInCustody.length > 0,
      count: kitsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          currently <strong>in custody</strong>.
        </>
      ),
      description:
        "Release the kit's custody before checking it out on a booking.",
      onResolve: () => removeItemsFromList(qrIdsOfKitsInCustody),
    },
    {
      id: "kits-booked-elsewhere",
      condition: kitsHeldElsewhere.length > 0,
      count: kitsHeldElsewhere.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already booked or checked out on another booking.
        </>
      ),
      description:
        "Another booking holds this kit for an overlapping period, or it has not come back from an overdue one.",
      onResolve: () => removeItemsFromList(qrIdsOfKitsHeldElsewhere),
    },
    {
      id: "kit-assets-booked-elsewhere",
      condition: assetsHeldElsewhere.length > 0,
      count: assetsHeldElsewhere.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> part
          of a kit that is booked or checked out on another booking.
        </>
      ),
      description:
        "The kit these assets belong to on this booking is held by another booking.",
      onResolve: () => removeItemsFromList(qrIdsOfAssetsHeldElsewhere),
    },
    {
      id: "redundant-kit-assets",
      condition: redundantAssetIds.length > 0,
      count: redundantAssetIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already covered by scanned kit QR codes.
        </>
      ),
      description: "Kit QR codes include all kit assets automatically",
      onResolve: () => removeItemsFromList(qrIdsOfRedundantAssets),
    },
    {
      id: "kits-not-in-booking",
      condition: kitsNotInBooking.length > 0,
      count: kitsNotInBooking.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong> not
          part of this booking.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsNotInBooking),
    },
    {
      id: "invalid-codes",
      condition: errorQrIds.length > 0,
      count: errorQrIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
          {count > 1 ? "are" : "is"} invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errorQrIds),
    },
  ];

  return {
    blockerConfigs,
  };
}
