import type { Kit } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { useSetAtom } from "jotai";
import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  removeMultipleScannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
} from "~/atoms/qr-scanner";
import type {
  AssetWithBooking,
  loader,
} from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";
import { Button } from "../shared/button";
import When from "../when/when";

interface Props {
  assets: AssetWithBooking[];
  items: ScanListItems;
  kits: KitForBooking[];
}

export function useBlockers(props: Props) {
  const { assets, items, kits } = props;
  const { booking } = useLoaderData<typeof loader>();
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  /**
   * Check which of tha assets are already added in the booking.assets
   * Returns an array of the assetIDs that are already added
   */
  const assetsAlreadyAddedIds: string[] = assets
    .filter((asset) => !!asset)
    .filter((asset) => booking.assets.some((a) => a?.id === asset.id))
    .map((a) => !!a && a.id);
  const hasAssetsAlreadyAdded = assetsAlreadyAddedIds.length > 0;

  /** Get list of ids of the assets that are part of kit */
  const assetsPartOfKitIds: string[] = assets
    .filter((asset) => !!asset && asset.kitId && asset.id)
    .map((asset) => asset.id);
  const hasAssetsPartOfKit = assetsPartOfKitIds.length > 0;

  /** Get assets marked as unavailable to book */
  const unavailableAssetsIds = assets
    .filter((asset) => !asset.availableToBook)
    .map((a) => !!a && a.id);
  const hasUnavailableAssets = unavailableAssetsIds.length > 0;

  /** To get the QR ids of the kits that include unavailable assets,
   * we first find the kits and
   * then we we search in the items to kind the keys that hold those kits */
  const kitsWithUnavailableAssets = kits
    .filter((kit) => kit.assets.some((a) => !a.availableToBook))
    .map((kit) => kit.id);
  const countKitsWithUnavailableAssets = kitsWithUnavailableAssets.length;

  const qrIdsOfUnavailableKits = Object.entries(items)
    .filter(([qrId, item]) => {
      if (!item || item.type !== "kit") return false;

      if (kitsWithUnavailableAssets.includes((item?.data as Kit)?.id)) {
        return qrId;
      }
      return false;
    })
    .map(([qrId]) => qrId);

  const hasUnavailableAssetsInKits = countKitsWithUnavailableAssets > 0;

  /** QR codes that were scanned but are not valid to be added */
  const hasErrors = errors.length > 0;

  const hasConflictsToResolve =
    hasAssetsAlreadyAdded ||
    hasAssetsPartOfKit ||
    hasErrors ||
    hasUnavailableAssets ||
    hasUnavailableAssetsInKits;

  const totalUnresolvedConflicts =
    unavailableAssetsIds.length +
    assetsAlreadyAddedIds.length +
    assetsPartOfKitIds.length +
    countKitsWithUnavailableAssets +
    errors.length;

  function resolveAllConflicts() {
    removeAssetsFromList([
      ...assetsAlreadyAddedIds,
      ...assetsPartOfKitIds,
      ...unavailableAssetsIds,
    ]);
    removeItemsFromList([
      ...errors.map(([qrId]) => qrId),
      ...qrIdsOfUnavailableKits,
    ]);
  }

  function Blockers() {
    return (
      <>
        <When truthy={hasConflictsToResolve}>
          <motion.div
            className="bg-gray-25 p-4 text-[12px]"
            transition={{ duration: 0.2 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[14px] font-semibold">
                  ⚠️ Unresolved blockers ({totalUnresolvedConflicts})
                </p>
                <p className="leading-4">
                  Resolve the issues below to continue. They are currently
                  blocking you from being able to confirm.
                </p>
              </div>

              <Button
                variant="secondary"
                size="xs"
                className="whitespace-nowrap text-[12px] leading-3"
                onClick={resolveAllConflicts}
                title="Removes all conflicting items from the list"
              >
                Resolve all ({totalUnresolvedConflicts})
              </Button>
            </div>

            <hr className="my-2" />
            <ul className="list-inside list-disc text-[12px] text-gray-500">
              {/* Unavailable assets */}
              <When truthy={hasUnavailableAssets}>
                <li>
                  <strong>
                    {`${unavailableAssetsIds.length} asset${
                      unavailableAssetsIds.length > 1 ? "s are" : " is"
                    }`}
                  </strong>{" "}
                  marked as <strong>unavailable</strong>.{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="text-gray inline text-[12px] font-normal underline"
                    onClick={() => {
                      removeAssetsFromList(unavailableAssetsIds);
                    }}
                  >
                    Remove from list
                  </Button>{" "}
                </li>
              </When>

              {/* Already added assets */}
              <When truthy={hasAssetsAlreadyAdded}>
                <li>
                  <strong>
                    {`${assetsAlreadyAddedIds.length} asset${
                      assetsAlreadyAddedIds.length > 1 ? "s" : ""
                    }`}
                  </strong>{" "}
                  already added to the booking.{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="text-gray inline text-[12px] font-normal underline"
                    onClick={() => {
                      removeAssetsFromList(assetsAlreadyAddedIds);
                    }}
                  >
                    Remove from list
                  </Button>{" "}
                </li>
              </When>

              {/* Assets part of kit */}
              <When truthy={hasAssetsPartOfKit}>
                <li>
                  <strong>{`${assetsPartOfKitIds.length} asset${
                    assetsPartOfKitIds.length > 1 ? "s" : ""
                  } `}</strong>
                  are part of a kit.{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="text-gray inline text-[12px] font-normal underline"
                    onClick={() => {
                      removeAssetsFromList(assetsPartOfKitIds);
                    }}
                  >
                    Remove from list
                  </Button>{" "}
                  <p className="text-[10px]">
                    Note: Scan Kit QR to add the full kit
                  </p>
                </li>
              </When>

              <When truthy={hasUnavailableAssetsInKits}>
                <li>
                  <strong>{`${countKitsWithUnavailableAssets} kit${
                    countKitsWithUnavailableAssets > 1 ? "s have" : " has"
                  } `}</strong>
                  unavailable assets inside{" "}
                  {countKitsWithUnavailableAssets > 1 ? "them" : "it"}.{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="text-gray inline text-[12px] font-normal underline"
                    onClick={() => {
                      removeItemsFromList(qrIdsOfUnavailableKits);
                    }}
                  >
                    Remove from list
                  </Button>{" "}
                </li>
              </When>

              <When truthy={hasErrors}>
                <li>
                  <strong>{`${errors.length} QR codes `}</strong>
                  are invalid.{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="text-gray inline text-[12px] font-normal underline"
                    onClick={() => {
                      removeItemsFromList(errors.map(([qrId]) => qrId));
                    }}
                  >
                    Remove from list
                  </Button>{" "}
                </li>
              </When>
            </ul>
          </motion.div>
        </When>
      </>
    );
  }

  return [hasConflictsToResolve, Blockers] as const;
}
