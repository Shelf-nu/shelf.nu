/**
 * Blocker lists for the two custody scanner drawers.
 *
 * A blocker is the row's answer to "why can this not go", and a missing one is
 * not a missing warning: a scanned row the drawer cannot act on is submitted
 * anyway, skipped by the service, and reported as a success. Three of those
 * shipped before these lists were pulled out of the drawers, because a drawer
 * component is impractical to mount in a test (its import graph reaches canvas)
 * and nothing else could see the list.
 *
 * So the derivation lives here, as a pure function of the scanned items, and
 * every blocker carries a stable `id` that a test can assert on. Adding a
 * blocker means adding a case to `custody-blockers.test.tsx`.
 *
 * @see {@link file://./../blockers-factory.tsx} renders what these return
 * @see {@link file://./assign-custody-drawer.tsx}
 * @see {@link file://./release-custody-drawer.tsx}
 */

import { AssetStatus, AssetType } from "@prisma/client";
import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  assignableUnits,
  hasKitInheritedCustody,
  operatorHolderCount,
} from "~/components/scanner/drawer/custody-scan-quantities";
import { isQuantityTracked } from "~/modules/asset/utils";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import type { BlockerConfig } from "../blockers-factory";

/** What a drawer hands in so a resolved blocker can drop its rows. */
export type CustodyBlockerArgs = {
  /** The scanned rows, keyed by the code that resolved them. */
  items: ScanListItems;
  /** Drops rows by ASSET id. */
  removeAssetsFromList: (assetIds: string[]) => void;
  /** Drops rows by the CODE that scanned them, which is how kits are keyed. */
  removeItemsFromList: (qrIds: string[]) => void;
};

/** A built list, plus the resolve-all that clears every row it named. */
export type CustodyBlockers = {
  blockerConfigs: BlockerConfig[];
  onResolveAll: () => void;
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

/** Codes that failed to resolve to anything. */
function errorQrIdsOf(items: ScanListItems): string[] {
  return Object.entries(items)
    .filter(([, item]) => !!item?.error)
    .map(([qrId]) => qrId);
}

/**
 * Kits are removed by the CODE that scanned them, not by kit id, because the
 * scanned-items map is keyed by code.
 */
function qrIdsForKitIds(items: ScanListItems, kitIds: string[]): string[] {
  return Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitIds.includes((item.data as KitFromQr)?.id);
    })
    .map(([qrId]) => qrId);
}

/** The invalid-code blocker, identical on both drawers. */
function invalidCodesBlocker(
  errorQrIds: string[],
  removeItemsFromList: (qrIds: string[]) => void
): BlockerConfig {
  return {
    id: "invalid-codes",
    condition: errorQrIds.length > 0,
    count: errorQrIds.length,
    message: (count: number) => (
      <>
        <strong>{`${count} QR codes `}</strong> are invalid.
      </>
    ),
    onResolve: () => removeItemsFromList(errorQrIds),
  };
}

/**
 * Blockers for the assign-custody drawer.
 *
 * The status blockers are scoped to INDIVIDUAL assets on purpose: `Asset.status`
 * is one flag for the whole row, so a quantity-tracked pool reads IN_CUSTODY
 * while a single unit is held and the rest is free stock. What a quantity row
 * may claim is its own free pool, which `qty-nothing-free` judges instead.
 */
export function buildAssignCustodyBlockers({
  items,
  removeAssetsFromList,
  removeItemsFromList,
}: CustodyBlockerArgs): CustodyBlockers {
  const assets = assetsOf(items);
  const kits = kitsOf(items);
  const errorQrIds = errorQrIdsOf(items);

  const assetsAlreadyInCustody = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.status === AssetStatus.IN_CUSTODY
    )
    .map((asset) => asset.id);

  const assetsAreCheckedOut = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.status === AssetStatus.CHECKED_OUT
    )
    .map((asset) => asset.id);

  /**
   * Quantity rows with nothing free to hand over: every unit is in custody,
   * allocated to a kit, or out on a booking. The row renders no quantity input,
   * so without this it is submitted as a whole asset and skipped with the rest
   * of the quantity-tracked batch, reporting success while nothing moved.
   */
  const qtyAssetsWithNothingFree = assets
    .filter(
      (asset) =>
        !!asset && isQuantityTracked(asset) && assignableUnits(asset) <= 0
    )
    .map((asset) => asset.id);

  const assetsArePartOfKit = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.assetKits.length > 0 &&
        asset.id
    )
    .map((asset) => asset.id);

  const qrIdsOfKitsInCustody = qrIdsForKitIds(
    items,
    kits
      .filter((kit) => kit.status === AssetStatus.IN_CUSTODY)
      .map((kit) => kit.id)
  );

  const qrIdsOfKitsWithAssetsInCustody = qrIdsForKitIds(
    items,
    kits
      .filter((kit) =>
        kit.assetKits.some((ak) => ak.asset.status === AssetStatus.IN_CUSTODY)
      )
      .map((kit) => kit.id)
  );

  const qrIdsOfKitsCheckedOut = qrIdsForKitIds(
    items,
    kits
      .filter((kit) => kit.status === AssetStatus.CHECKED_OUT)
      .map((kit) => kit.id)
  );

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "qty-nothing-free",
      condition: qtyAssetsWithNothingFree.length > 0,
      count: qtyAssetsWithNothingFree.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s have" : " has"}`}</strong> no
          units available.
        </>
      ),
      description:
        "Every unit is already in custody, allocated to a kit, or out on a booking.",
      onResolve: () => removeAssetsFromList(qtyAssetsWithNothingFree),
    },
    {
      id: "assets-already-in-custody",
      condition: assetsAlreadyInCustody.length > 0,
      count: assetsAlreadyInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyInCustody),
    },
    {
      id: "assets-checked-out",
      condition: assetsAreCheckedOut.length > 0,
      count: assetsAreCheckedOut.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          checked out.
        </>
      ),
      description: "Note: Checked out assets cannot be assigned custody.",
      onResolve: () => removeAssetsFromList(assetsAreCheckedOut),
    },
    {
      id: "assets-part-of-kit",
      condition: assetsArePartOfKit.length > 0,
      count: assetsArePartOfKit.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong> are part
          of a kit.
        </>
      ),
      description: "Note: Scan Kit QR to add the full kit",
      onResolve: () => removeAssetsFromList(assetsArePartOfKit),
    },
    {
      id: "kits-in-custody",
      condition: qrIdsOfKitsInCustody.length > 0,
      count: qrIdsOfKitsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          already <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsInCustody),
    },
    {
      id: "kits-with-assets-in-custody",
      condition: qrIdsOfKitsWithAssetsInCustody.length > 0,
      count: qrIdsOfKitsWithAssetsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          already have assets <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsWithAssetsInCustody),
    },
    {
      id: "kits-checked-out",
      condition: qrIdsOfKitsCheckedOut.length > 0,
      count: qrIdsOfKitsCheckedOut.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          checked out.
        </>
      ),
      description: "Note: Checked out kits cannot be assigned custody.",
      onResolve: () => removeItemsFromList(qrIdsOfKitsCheckedOut),
    },
    invalidCodesBlocker(errorQrIds, removeItemsFromList),
  ];

  return {
    blockerConfigs,
    onResolveAll: () => {
      removeAssetsFromList([
        ...qtyAssetsWithNothingFree,
        ...assetsAlreadyInCustody,
        ...assetsAreCheckedOut,
        ...assetsArePartOfKit,
      ]);
      removeItemsFromList([
        ...errorQrIds,
        ...qrIdsOfKitsInCustody,
        ...qrIdsOfKitsWithAssetsInCustody,
        ...qrIdsOfKitsCheckedOut,
      ]);
    },
  };
}

/**
 * Blockers for the release-custody drawer.
 *
 * A release scan names no custodian, it takes the asset back from whoever holds
 * it, so it is only unambiguous while exactly one person does. The three
 * quantity blockers split that into its causes because the advice differs: go
 * to the kit, go to the asset's custody list, or there is nothing to release.
 */
export function buildReleaseCustodyBlockers({
  items,
  removeAssetsFromList,
  removeItemsFromList,
}: CustodyBlockerArgs): CustodyBlockers {
  const assets = assetsOf(items);
  const kits = kitsOf(items);
  const errorQrIds = errorQrIdsOf(items);

  const qtyAssetsHeldViaKitOnly = assets
    .filter(
      (asset) =>
        !!asset &&
        isQuantityTracked(asset) &&
        operatorHolderCount(asset) === 0 &&
        hasKitInheritedCustody(asset)
    )
    .map((asset) => asset.id);

  const qtyAssetsWithNothingHeld = assets
    .filter(
      (asset) =>
        !!asset &&
        isQuantityTracked(asset) &&
        operatorHolderCount(asset) === 0 &&
        !hasKitInheritedCustody(asset)
    )
    .map((asset) => asset.id);

  const qtyAssetsWithSeveralHolders = assets
    .filter(
      (asset) =>
        !!asset && isQuantityTracked(asset) && operatorHolderCount(asset) > 1
    )
    .map((asset) => asset.id);

  /**
   * Whole-asset statement, so INDIVIDUAL only: a quantity row can hold units
   * for someone while its overall status reads otherwise.
   */
  const assetsNotInCustody = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.status !== AssetStatus.IN_CUSTODY
    )
    .map((asset) => asset.id);

  const assetsArePartOfKit = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.assetKits.length > 0 &&
        asset.id
    )
    .map((asset) => asset.id);

  const qrIdsOfKitsNotInCustody = qrIdsForKitIds(
    items,
    kits
      .filter((kit) => kit.status !== AssetStatus.IN_CUSTODY)
      .map((kit) => kit.id)
  );

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "qty-held-via-kit",
      condition: qtyAssetsHeldViaKitOnly.length > 0,
      count: qtyAssetsHeldViaKitOnly.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> held
          through a kit.
        </>
      ),
      description: "Scan the kit's QR to release the whole kit from custody.",
      onResolve: () => removeAssetsFromList(qtyAssetsHeldViaKitOnly),
    },
    {
      id: "qty-nothing-held",
      condition: qtyAssetsWithNothingHeld.length > 0,
      count: qtyAssetsWithNothingHeld.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s have" : " has"}`}</strong> no
          units in custody.
        </>
      ),
      description: "There is nothing to release for them.",
      onResolve: () => removeAssetsFromList(qtyAssetsWithNothingHeld),
    },
    {
      id: "qty-several-holders",
      condition: qtyAssetsWithSeveralHolders.length > 0,
      count: qtyAssetsWithSeveralHolders.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> held
          by more than one person.
        </>
      ),
      description:
        "Release these from the asset's custody list, where each holder is listed separately.",
      onResolve: () => removeAssetsFromList(qtyAssetsWithSeveralHolders),
    },
    {
      id: "assets-not-in-custody",
      condition: assetsNotInCustody.length > 0,
      count: assetsNotInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> not
          in custody.
        </>
      ),
      description: "Only assets in custody can be released.",
      onResolve: () => removeAssetsFromList(assetsNotInCustody),
    },
    {
      id: "assets-part-of-kit",
      condition: assetsArePartOfKit.length > 0,
      count: assetsArePartOfKit.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong> are part
          of a kit.
        </>
      ),
      description: "Note: Scan Kit QR to release the full kit from custody",
      onResolve: () => removeAssetsFromList(assetsArePartOfKit),
    },
    {
      id: "kits-not-in-custody",
      condition: qrIdsOfKitsNotInCustody.length > 0,
      count: qrIdsOfKitsNotInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong> not
          in custody.
        </>
      ),
      description: "Only kits in custody can be released.",
      onResolve: () => removeItemsFromList(qrIdsOfKitsNotInCustody),
    },
    invalidCodesBlocker(errorQrIds, removeItemsFromList),
  ];

  return {
    blockerConfigs,
    onResolveAll: () => {
      removeAssetsFromList([
        ...qtyAssetsHeldViaKitOnly,
        ...qtyAssetsWithNothingHeld,
        ...qtyAssetsWithSeveralHolders,
        ...assetsNotInCustody,
        ...assetsArePartOfKit,
      ]);
      removeItemsFromList([...errorQrIds, ...qrIdsOfKitsNotInCustody]);
    },
  };
}
