import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetStatus } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  removeScannedItemsByAssetIdAtom,
  scannedItemsAtom,
  scannedItemsIdsAtom,
  updateScannedItemAtom,
} from "~/atoms/qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { type loader } from "~/routes/_layout+/bookings.$bookingId_.scan-assets";
import { tw } from "~/utils/tw";
import { AvailabilityLabel } from "../booking/availability-label";
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
  const assets = Object.values(items).filter(
    (asset): asset is AssetWithBooking => !!asset
  );
  const clearList = useSetAtom(clearScannedItemsAtom);
  const assetsIds = useAtomValue(scannedItemsIdsAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);

  const itemsLength = Object.keys(items).length;
  const hasItems = itemsLength > 0;

  const [expanded, setExpanded] = useState(false);
  const { vh } = useViewportHeight();

  /**
   * Check which of tha assets are already added in the booking.assets
   * Returns an array of the assetIDs that are already added
   */
  const assetsAlreadyAdded: string[] = assetsIds
    .filter((assetId): assetId is string => !!assetId)
    .filter((assetId) => booking.assets.some((a) => a?.id === assetId));
  const hasAssetsAlreadyAdded = assetsAlreadyAdded.length > 0;

  const assetsPartOfKit = Object.values(items)
    .filter((asset): asset is AssetWithBooking => !!asset)
    .filter((asset) => asset?.kitId && asset.id)
    .map((asset) => asset.id);
  const hasAssetsPartOfKit = assetsPartOfKit.length > 0;

  const hasConflictsToResolve = hasAssetsAlreadyAdded || hasAssetsPartOfKit;
  function resolveAllConflicts() {
    removeAssetsFromList([...assetsAlreadyAdded, ...assetsPartOfKit]);
  }

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
          <div className="sr-only">Add assets to booking via scan</div>

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
              <div className="py-4">{`${itemsLength} asset${
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
              <div className="flex max-h-full flex-col overflow-scroll">
                {/* Assets list */}
                <div>
                  <Table className="overflow-y-auto">
                    <ListHeader hideFirstColumn className="border-none">
                      <Th className="p-0"> </Th>
                      <Th className="p-0"> </Th>
                    </ListHeader>

                    <tbody>
                      {Object.entries(items).map(([qrId, asset]) => (
                        <AssetRow qrId={qrId} key={qrId} asset={asset} />
                      ))}
                    </tbody>
                  </Table>
                </div>

                {/* Actions */}
                <div>
                  <When truthy={hasConflictsToResolve}>
                    <div className="bg-gray-25 p-4 text-[12px]">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[14px] font-semibold">
                            Unresolved blockers
                          </p>
                          <p>Resolve the issues below to continue</p>
                        </div>

                        <Button
                          variant="block-link"
                          className="text-[12px]"
                          onClick={resolveAllConflicts}
                        >
                          Resolve all
                        </Button>
                      </div>

                      <hr className="my-2" />
                      <ul className="list-inside list-disc text-[12px] text-gray-500">
                        <When truthy={hasAssetsAlreadyAdded}>
                          <li>
                            <strong>{assetsAlreadyAdded.length}</strong> assets
                            already added to the booking.{" "}
                            <Button
                              variant="link"
                              type="button"
                              className="text-gray inline text-[12px] font-normal underline"
                              onClick={() => {
                                removeAssetsFromList(assetsAlreadyAdded);
                              }}
                            >
                              Remove from list
                            </Button>{" "}
                            to continue.
                          </li>
                        </When>
                        <When truthy={hasAssetsPartOfKit}>
                          <li>
                            <strong>{assetsPartOfKit.length}</strong> assets Are
                            part of a kit.{" "}
                            <Button
                              variant="link"
                              type="button"
                              className="text-gray inline text-[12px] font-normal underline"
                              onClick={() => {
                                removeAssetsFromList(assetsPartOfKit);
                              }}
                            >
                              Remove from list
                            </Button>{" "}
                            to continue.
                          </li>
                        </When>
                      </ul>
                    </div>
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
                    <div className="flex w-full gap-2 px-0 py-3">
                      {assets.map((asset, index) => (
                        <input
                          key={asset.id}
                          type="hidden"
                          name={`assetIds[${index}]`}
                          value={asset.id}
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

function AssetRow({
  qrId,
  asset,
}: {
  qrId: string;
  asset: AssetWithBooking | undefined;
}) {
  const { booking } = useLoaderData<typeof loader>();
  const setAsset = useSetAtom(updateScannedItemAtom);
  const removeAsset = useSetAtom(removeScannedItemAtom);

  const isCheckedOut = useMemo(
    () => asset?.status === AssetStatus.CHECKED_OUT,
    [asset]
  );

  /** Fetches asset data based on qrId */
  const fetchAsset = useCallback(async () => {
    const response = await fetch(
      `/api/bookings/get-scanned-asset?qrId=${qrId}&bookingId=${booking.id}`
    );
    const { asset } = await response.json();
    setAsset({ qrId, asset });
  }, [qrId, booking.id, setAsset]);

  /** Fetch the asset when qrId or booking changes */
  useEffect(() => {
    void fetchAsset();
  }, [qrId, booking.id, setAsset, fetchAsset]);

  return (
    <Tr key={qrId}>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-y-1">
              {!asset ? (
                <div>
                  <p>
                    QR id: <span className="font-semibold">{qrId}</span>
                  </p>{" "}
                  <TextLoader
                    text="Fetching asset"
                    className="text-[10px] text-gray-500"
                  />
                </div>
              ) : (
                <>
                  <p className="word-break whitespace-break-spaces font-medium">
                    {asset.title}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <AvailabilityLabel
                      isAddedThroughKit={
                        booking.assets.some((a) => a.id === asset.id) &&
                        !!asset.kitId
                      }
                      isAlreadyAdded={booking.assets.some(
                        (a) => a.id === asset.id
                      )}
                      showKitStatus
                      asset={asset}
                      isCheckedOut={isCheckedOut}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <Button
          className="border-none"
          variant="ghost"
          icon="trash"
          onClick={() => removeAsset(qrId)}
        />
      </Td>
    </Tr>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr
      className="h-[80px] items-center hover:bg-gray-50"
      style={{
        transform: "translateZ(0)",
        willChange: "transform",
        backgroundAttachment: "initial",
      }}
    >
      {children}
    </tr>
  );
}

function TextLoader({ text, className }: { text: string; className?: string }) {
  return <div className={tw("loading-text", className)}>{text}...</div>;
}
