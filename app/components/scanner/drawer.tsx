import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetStatus } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearScannedQrIdsAtom,
  removeScannedQrIdAtom,
  scannedQrIdsAtom,
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
  const qrIds = useAtomValue(scannedQrIdsAtom);
  const removeQrId = useSetAtom(removeScannedQrIdAtom);
  const assetsLength = qrIds.length;
  const hasAssets = assetsLength > 0;
  const clearList = useSetAtom(clearScannedQrIdsAtom);

  /** Removes an set of assets from the list
   * Handles both the qrIds and the assets array
   */
  function removeAssetsFromList(assets: AssetWithBooking[]) {
    setAssets((prev) =>
      prev.filter((a) => !assets.some((aa) => aa?.id === a?.id))
    );
    assets.forEach((a) => {
      removeQrId(a?.qrScanned);
    });
  }

  const [expanded, setExpanded] = useState(false);
  const { vh } = useViewportHeight();
  const [assets, setAssets] = useState<AssetWithBooking[]>([]);

  // /**
  //  * Clear the list when the component is unmounted
  //  */
  // useEffect(
  //   () => () => {
  //     clearList();
  //     setAssets([]);
  //   },
  //   [clearList]
  // );

  /**
   * Check which of tha assets are already added in the booking.assets
   */
  const assetsAlreadyAdded = assets.filter((asset) =>
    booking.assets.some((a) => a?.id === asset?.id)
  );

  const hasAssetsAlreadyAdded = assetsAlreadyAdded.length > 0;

  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out",
          className
        )}
        style={{
          height: expanded ? vh - TOP_GAP : hasAssets ? 170 : 148,
        }}
      >
        <div className={tw("h-full")} style={style}>
          <div className="sr-only">Add assets to booking via scan</div>

          <div className="mx-auto inline-flex size-full flex-col px-4 md:max-w-4xl md:px-0">
            {/* Handle */}
            <motion.div
              className="border-b py-1 text-center hover:cursor-grab"
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
            <div className="flex items-center justify-between text-left">
              <div className="py-4">{assetsLength} assets scanned</div>

              <When truthy={hasAssets}>
                <Button variant="tertiary" onClick={clearList}>
                  Clear list
                </Button>
              </When>
            </div>

            {/* Body */}
            <When truthy={!hasAssets}>
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

            <When truthy={hasAssets}>
              <Form
                ref={zo.ref}
                className="flex max-h-full w-full flex-col overflow-scroll"
                method="POST"
              >
                <div className="flex max-h-full flex-col overflow-scroll">
                  {/* Assets list */}
                  <div>
                    <Table className="overflow-y-auto">
                      <ListHeader hideFirstColumn>
                        <Th className="p-0"> </Th>
                        <Th className="p-0"> </Th>
                      </ListHeader>

                      <tbody>
                        {qrIds.reverse().map((id, index) => (
                          <AssetRow
                            qrId={id}
                            key={id}
                            booking={booking}
                            assets={assets}
                            setAssets={setAssets}
                            index={index}
                          />
                        ))}
                      </tbody>
                    </Table>
                  </div>

                  {/* Actions */}
                  <div>
                    <When truthy={hasAssetsAlreadyAdded}>
                      <div className="bg-warning-25 p-4">
                        <p className="text-sm text-gray-500">
                          <strong>{assetsAlreadyAdded.length}</strong> assets
                          already added to the booking.{" "}
                          <Button
                            variant="link"
                            className="text-gray inline underline"
                            onClick={() =>
                              removeAssetsFromList(assetsAlreadyAdded)
                            }
                          >
                            Remove from list
                          </Button>{" "}
                          to continue.
                        </p>
                      </div>
                    </When>

                    <When truthy={!!zo.errors.assetIds()?.message}>
                      <p className="text-sm text-error-500">
                        {zo.errors.assetIds()?.message}
                      </p>
                    </When>

                    <div className="flex gap-2 px-0 py-3">
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
                  </div>
                </div>
              </Form>
            </When>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function AssetRow({
  qrId,
  assets,
  setAssets,
  index,
}: {
  qrId: string;
  booking: any;
  index: number;
  assets: AssetWithBooking[];
  setAssets: React.Dispatch<React.SetStateAction<AssetWithBooking[]>>;
}) {
  const { booking } = useLoaderData<typeof loader>();

  const removeQrId = useSetAtom(removeScannedQrIdAtom);
  /** Remove the asset from the list */
  function removeAssetFromList() {
    // Remive the qrId from the list
    removeQrId(qrId);
    // Remove the asset from the list
    setAssets((prev) => prev.filter((a) => a?.qrScanned !== qrId));
  }

  /** Find the asset in the assets array */
  const asset = useMemo(
    () => assets.find((a) => a?.qrScanned === qrId),
    [assets, qrId]
  );

  const isCheckedOut = useMemo(
    () => asset?.status === AssetStatus.CHECKED_OUT,
    [asset]
  );

  /** Adds an asset to the assets array */
  const setAsset = useCallback(
    (asset: AssetWithBooking) => {
      setAssets((prev) => {
        /** Only add it it doesnt exist in the list already */
        if (asset && prev.some((a) => a && a.id === asset.id)) {
          return prev;
        }
        return [...prev, asset];
      });
    },
    [setAssets]
  );

  /** Fetches asset data based on qrId */
  const fetchAsset = useCallback(async () => {
    const response = await fetch(
      `/api/bookings/get-scanned-asset?qrId=${qrId}&bookingId=${booking.id}`
    );
    const { asset } = await response.json();
    setAsset(asset);
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
                  <input
                    type="hidden"
                    name={`assetIds[${index}]`}
                    value={asset.id}
                  />
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
          onClick={removeAssetFromList}
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
