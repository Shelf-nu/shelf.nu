import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Kit, Prisma } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import type { ScanListItem } from "~/atoms/qr-scanner";
import {
  clearScannedItemsAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemAtom,
  removeScannedItemsByAssetIdAtom,
  scannedItemsAtom,
  updateScannedItemAtom,
} from "~/atoms/qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";
import { type loader } from "~/routes/_layout+/bookings.$bookingId.scan-assets";
import { tw } from "~/utils/tw";
import { AvailabilityBadge } from "../booking/availability-label";
import { AssetLabel } from "../icons/library";
import { ListHeader } from "../list/list-header";
import { Button } from "../shared/button";

import { Table, Td, Th } from "../table";
import When from "../when/when";

type ScannedAssetsDrawerProps = {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
};

export const addScannedAssetsToBookingSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

/** Used for calculating expanded size */
const TOP_GAP = 80 + 53 + 8 + 16;

const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body);

export default function ScannedAssetsDrawer({
  className,
  style,
  isLoading,
}: ScannedAssetsDrawerProps) {
  const { booking } = useLoaderData<typeof loader>();
  const zo = useZorm(
    "AddScannedAssetsToBooking",
    addScannedAssetsToBookingSchema
  );

  // Get the scanned qrIds
  const items = useAtomValue(scannedItemsAtom);
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetWithBooking);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitForBooking);

  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  const itemsLength = Object.keys(items).length;
  const hasItems = itemsLength > 0;

  const [expanded, setExpanded] = useState(false);
  const { vh } = useViewportHeight();

  const itemsListRef = useRef<HTMLDivElement>(null);
  const prevItemsLengthRef = useRef<number>(itemsLength);

  useEffect(() => {
    /** When the items.length increases, scroll the item list div to the top */
    if (itemsListRef.current && itemsLength > prevItemsLengthRef.current) {
      itemsListRef.current.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
    prevItemsLengthRef.current = itemsLength;
  }, [expanded, itemsLength]);

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

  /** List of ids from:
   * - all items with type asset
   * - all assets attached to items with type kit
   * */

  const assetIdsForBooking = Array.from(
    new Set([
      ...assets.map((a) => a.id),
      ...kits.flatMap((k) => k.assets.map((a) => a.id)),
    ])
  );

  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out",
          className
        )}
        style={{
          height: expanded ? vh - TOP_GAP : hasItems ? 170 : 148,
        }}
      >
        <div className={tw("h-full")} style={style}>
          <div className="sr-only">Add assets and kits to booking via scan</div>

          <div className="mx-auto inline-flex size-full flex-col px-4 md:max-w-4xl md:px-0">
            {/* Handle */}
            <motion.div
              className="py-1 text-center hover:cursor-grab"
              onClick={() => {
                setExpanded((prev) => !prev);
              }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              onDragEnd={(_, info) => {
                const shouldExpand = info.offset.y < 0;
                setExpanded(shouldExpand);
              }}
            >
              {/* Drag me */}
              <div className="mx-auto my-1 h-2 w-[30px] rounded-full bg-gray-500/50" />
            </motion.div>

            {/* Header */}
            <div className="flex items-center justify-between border-b text-left">
              <div className="py-4">{`${itemsLength} item${
                itemsLength > 1 ? "s" : ""
              } scanned`}</div>

              <When truthy={hasItems}>
                <Button
                  variant="block-link-gray"
                  onClick={clearList}
                  className="text-[12px] font-normal text-gray-500"
                >
                  Clear list
                </Button>
              </When>
            </div>

            {/* Body */}
            <When truthy={!hasItems}>
              <div className="flex flex-col items-center px-3 py-6 text-center">
                {expanded && (
                  <div className="mb-4 rounded-full bg-primary-50  p-2">
                    <div className=" rounded-full bg-primary-100 p-2 text-primary">
                      <AssetLabel className="size-6" />
                    </div>
                  </div>
                )}

                <div>
                  {expanded && (
                    <div className="text-base font-semibold text-gray-900">
                      List is empty
                    </div>
                  )}

                  <p className="text-sm text-gray-600">
                    Fill list by scanning codes...
                  </p>
                </div>
              </div>
            </When>

            <When truthy={hasItems}>
              <div
                className="-ml-4 flex max-h-full w-screen flex-col overflow-scroll"
                ref={itemsListRef}
              >
                {/* Assets list */}
                <div>
                  <Table className="overflow-y-auto">
                    <ListHeader hideFirstColumn className="border-none">
                      <Th className="p-0"> </Th>
                      <Th className="p-0"> </Th>
                    </ListHeader>

                    <tbody>
                      <AnimatePresence>
                        {Object.entries(items).map(([qrId, item]) => (
                          <ItemRow qrId={qrId} key={qrId} item={item} />
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </Table>
                </div>

                {/* Actions */}
                <div>
                  {/* Blockers */}
                  <When truthy={hasConflictsToResolve}>
                    <motion.div
                      className="bg-gray-25 p-4 text-[12px]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[14px] font-semibold">
                            ⚠️ Unresolved blockers ({totalUnresolvedConflicts})
                          </p>
                          <p className="leading-4">
                            Resolve the issues below to continue. They are
                            currently blocking you from being able to confirm.
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
                                unavailableAssetsIds.length > 1
                                  ? "s are"
                                  : " is"
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
                              countKitsWithUnavailableAssets > 1
                                ? "s have"
                                : " has"
                            } `}</strong>
                            unavailable assets inside{" "}
                            {countKitsWithUnavailableAssets > 1 ? "them" : "it"}
                            .{" "}
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
                                removeItemsFromList(
                                  errors.map(([qrId]) => qrId)
                                );
                              }}
                            >
                              Remove from list
                            </Button>{" "}
                            <p className="text-[10px]">
                              Note: Scan Kit QR to add the full kit
                            </p>
                          </li>
                        </When>
                      </ul>
                    </motion.div>
                  </When>

                  <When truthy={!!zo.errors.assetIds()?.message}>
                    <p className="text-sm text-error-500">
                      {zo.errors.assetIds()?.message}
                    </p>
                  </When>
                  <Form
                    ref={zo.ref}
                    className="flex max-h-full w-full"
                    method="POST"
                  >
                    <div className="flex w-full gap-2 p-3">
                      {assetIdsForBooking.map((assetId, index) => (
                        <input
                          key={assetId}
                          type="hidden"
                          name={`assetIds[${index}]`}
                          value={assetId}
                        />
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        width="full"
                        disabled={isLoading}
                      >
                        Close
                      </Button>

                      <Button
                        width="full"
                        type="submit"
                        disabled={isLoading || hasAssetsAlreadyAdded}
                      >
                        Confirm
                      </Button>
                    </div>
                  </Form>
                </div>
              </div>
            </When>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function ItemRow({ qrId, item }: { qrId: string; item: ScanListItem }) {
  const setItem = useSetAtom(updateScannedItemAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);

  /** Fetches item data based on qrId */
  const fetchItem = useCallback(async () => {
    const request = await fetch(`/api/get-scanned-item/${qrId}`);
    const response = await request.json();

    /** If the server returns an error, add it to the item and return */
    if (response.error) {
      setItem({
        qrId,
        item: { error: response.error.message, count: 1 },
      });
      return;
    }

    const qr: Prisma.QrGetPayload<{
      include: {
        asset: true;
        kit: true;
      };
    }> & {
      type: "asset" | "kit" | undefined;
    } = response.qr;

    const itemWithType =
      qr && qr.type === "asset"
        ? { data: qr.asset, type: "asset" }
        : { data: qr.kit, type: "kit" };

    if (itemWithType && itemWithType?.data) {
      setItem({
        qrId,
        item: itemWithType as ScanListItem,
      });
    }
  }, [qrId, setItem]);

  /** Fetch the asset when qrId or booking changes */
  useEffect(() => {
    void fetchItem();
  }, [qrId, setItem, fetchItem]);

  const hasItem = !!item && !!item.data;
  const isAsset = item?.type === "asset";
  const isKit = item?.type === "kit";
  const itemData = isAsset
    ? (item?.data as Asset)
    : isKit
    ? (item?.data as Kit)
    : undefined;

  return (
    <Tr key={qrId}>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <When truthy={!hasItem}>
            <RowLoadingState qrId={qrId} error={item?.error} />
          </When>

          {/* Render asset row */}
          <When truthy={isAsset}>
            <AssetRow asset={itemData as AssetWithBooking} />
          </When>

          <When truthy={isKit}>
            <KitRow kit={itemData as KitForBooking} />
          </When>
        </div>
      </Td>
      <Td>
        <Button
          className="border-none text-gray-500 hover:text-gray-700"
          variant="ghost"
          icon="trash"
          onClick={() => removeItem(qrId)}
        />
      </Td>
    </Tr>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: -80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      exit={{ opacity: 0 }}
      className="h-[80px] items-center border-b hover:bg-gray-50 [&_td]:border-b-0"
      style={{
        transform: "translateZ(0)",
        willChange: "transform",
        backgroundAttachment: "initial",
      }}
    >
      {children}
    </motion.tr>
  );
}

function TextLoader({ text, className }: { text: string; className?: string }) {
  return <div className={tw("loading-text", className)}>{text}...</div>;
}

function RowLoadingState({ qrId, error }: { qrId: string; error?: string }) {
  const items = useAtomValue(scannedItemsAtom);
  const item = items[qrId];
  // console.log(item);
  return (
    <div className="max-w-full">
      <p>
        QR id: <span className="font-semibold">{qrId}</span>{" "}
        {item?.count > 1 && <>({item?.count})</>}
      </p>{" "}
      {error ? (
        <p className="whitespace-normal text-[12px] text-error-500">{error}</p>
      ) : (
        <TextLoader
          text="Fetching item"
          className="text-[10px] text-gray-500"
        />
      )}
    </div>
  );
}

function AssetRow({ asset }: { asset: AssetWithBooking }) {
  const { booking } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {asset.title}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        <span
          className={tw(
            "inline-block bg-gray-50 px-[6px] py-[2px]",
            "rounded-md border border-gray-200",
            "text-xs text-gray-700"
          )}
        >
          asset
        </span>
        <LocalAvailabilityLabel
          isPartOfKit={!!asset.kitId}
          isAlreadyAdded={booking.assets.some((a) => a?.id === asset.id)}
          isMarkedAsUnavailable={!asset.availableToBook}
        />
      </div>
    </div>
  );
}

function KitRow({ kit }: { kit: KitForBooking }) {
  const someAssetMarkedUnavailable = kit.assets.some(
    (asset) => !asset.availableToBook
  );
  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {kit.name}{" "}
        <span className="text-[12px] font-normal text-gray-700">
          ({kit._count.assets} assets)
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={tw(
            "inline-block bg-gray-50 px-[6px] py-[2px]",
            "rounded-md border border-gray-200",
            "text-xs text-gray-700"
          )}
        >
          kit
        </span>
        {someAssetMarkedUnavailable && (
          <AvailabilityBadge
            badgeText="Contains non-bookable assets"
            tooltipTitle="Kit is unavailable for check-out"
            tooltipContent="Some assets in this kit are marked as non-bookable. You can still add the kit to your booking, but you must remove the non-bookable assets to proceed with check-out."
          />
        )}
      </div>
    </div>
  );
}

/** The global one considers a lot of states that are not relevant for this UI.
 * Here we should show only the labels are blockers:
 * - asset is part of kit
 * - asset is already in the booking
 *   */
const LocalAvailabilityLabel = ({
  isPartOfKit,
  isAlreadyAdded,
  isMarkedAsUnavailable,
}: {
  isPartOfKit: boolean;
  isAlreadyAdded: boolean;
  isMarkedAsUnavailable: boolean;
}) => (
  <div className="flex gap-1">
    <When truthy={isMarkedAsUnavailable}>
      <AvailabilityBadge
        badgeText={"Unavailable"}
        tooltipTitle={"Asset is unavailable for bookings"}
        tooltipContent={
          "This asset is marked as unavailable for bookings by an administrator."
        }
      />
    </When>

    <When truthy={isAlreadyAdded}>
      <AvailabilityBadge
        badgeText="Already added to this booking"
        tooltipTitle="Asset is part of booking"
        tooltipContent="This asset is already added to the current booking."
      />
    </When>

    <When truthy={isPartOfKit}>
      <AvailabilityBadge
        badgeText="Part of kit"
        tooltipTitle="Asset is part of a kit"
        tooltipContent="Remove the asset from the kit to add it individually."
      />
    </When>
  </div>
);
