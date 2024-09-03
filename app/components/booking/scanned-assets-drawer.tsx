import { useEffect, useState } from "react";
import { AssetStatus } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearFetchedScannedAssetsAtom,
  fetchedScannedAssetsAtom,
  fetchedScannedAssetsCountAtom,
  removeFetchedScannedAssetAtom,
} from "~/atoms/bookings";
import { displayQrScannerNotificationAtom } from "~/atoms/qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { type loader } from "~/routes/_layout+/bookings.$bookingId_.scan-assets";
import { tw } from "~/utils/tw";
import { AvailabilityLabel } from "./availability-label";
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

  const [expanded, setExpanded] = useState(false);
  const { vh } = useViewportHeight();

  const fetchedScannedAssets = useAtomValue(fetchedScannedAssetsAtom);
  const fetchedScannedAssetsCount = useAtomValue(fetchedScannedAssetsCountAtom);
  const removeFetchedScannedAsset = useSetAtom(removeFetchedScannedAssetAtom);
  const clearFetchedScannedAssets = useSetAtom(clearFetchedScannedAssetsAtom);

  const hasAssets = fetchedScannedAssetsCount > 0;
  const displayQrNotification = useSetAtom(displayQrScannerNotificationAtom);

  const someAssetsCheckedOut = fetchedScannedAssets.some(
    (asset) => asset.status === AssetStatus.CHECKED_OUT
  );
  const someAssetsInCustody = fetchedScannedAssets.some(
    (asset) => asset.status === AssetStatus.IN_CUSTODY
  );

  // useEffect(() => {
  //   if (document) {
  //     document.body.style.overflow = expanded ? "hidden" : "auto";
  //     document.body.style.height = expanded ? "100vh" : "auto";
  //   }
  // }, [expanded]);

  // Handler for the drag end event
  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out"
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
              <div className="py-4">
                {fetchedScannedAssetsCount} assets scanned
              </div>

              <When truthy={hasAssets}>
                <div
                  className="cursor-pointer"
                  onClick={clearFetchedScannedAssets}
                >
                  Clear list
                </div>
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
              <div className="flex max-h-full flex-col overflow-scroll">
                {/* Assets list */}
                <div>
                  <Table className="overflow-y-auto">
                    <ListHeader hideFirstColumn>
                      <Th className="p-0"> </Th>
                      <Th className="p-0"> </Th>
                    </ListHeader>

                    <tbody>
                      {fetchedScannedAssets.map((asset) => (
                        <Tr key={asset.id}>
                          <Td className="w-full p-0 md:p-0">
                            <div className="flex items-center justify-between gap-3 p-4 md:px-6">
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col gap-y-1">
                                  <p className="word-break whitespace-break-spaces font-medium">
                                    {asset.title}
                                  </p>

                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <AvailabilityLabel
                                      isAddedThroughKit={
                                        booking.assets.some(
                                          (a) => a.id === asset.id
                                        ) && !!asset.kitId
                                      }
                                      isAlreadyAdded={booking.assets.some(
                                        (a) => a.id === asset.id
                                      )}
                                      showKitStatus
                                      asset={asset}
                                      isCheckedOut={
                                        asset.status === "CHECKED_OUT"
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Td>
                          <Td>
                            <Button
                              className="border-none"
                              variant="ghost"
                              icon="trash"
                              onClick={() => {
                                removeFetchedScannedAsset(asset.id);
                                displayQrNotification({
                                  message: "Asset was removed from list",
                                });
                              }}
                            />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {/* Actions */}
                <div>
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

                    <Form ref={zo.ref} className="w-full" method="POST">
                      {fetchedScannedAssets.map((asset, i) => (
                        <input
                          key={asset.id}
                          type="hidden"
                          name={`assetIds[${i}]`}
                          value={asset.id}
                        />
                      ))}

                      <Button
                        width="full"
                        disabled={
                          isLoading ||
                          someAssetsCheckedOut ||
                          someAssetsInCustody
                        }
                      >
                        Confirm
                      </Button>
                    </Form>
                  </div>
                </div>
              </div>
            </When>
          </div>
        </div>
      </div>
    </Portal>
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
