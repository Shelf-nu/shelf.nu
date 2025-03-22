import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Kit, Prisma } from "@prisma/client";
import { Form, useLoaderData, useRouteLoaderData } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronUpIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import type { ScanListItem } from "~/atoms/qr-scanner";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  updateScannedItemAtom,
} from "~/atoms/qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";
import { type loader } from "~/routes/_layout+/bookings.$bookingId.scan-assets";
import { tw } from "~/utils/tw";
import { useBlockers } from "./blockers";
import { AvailabilityBadge } from "../../../booking/availability-label";
import { AssetLabel } from "../../../icons/library";
import { ListHeader } from "../../../list/list-header";
import { Button } from "../../../shared/button";

import { Table, Td, Th } from "../../../table";
import When from "../../../when/when";
import { useGlobalModeViaObserver } from "../../code-scanner";

type ScannedAssetsDrawerProps = {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
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
  defaultExpanded = false,
}: ScannedAssetsDrawerProps) {
  const zo = useZorm(
    "AddScannedAssetsToBooking",
    addScannedAssetsToBookingSchema
  );

  let minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;

  // Get the scanned qrIds
  const items = useAtomValue(scannedItemsAtom);
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetWithBooking);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitForBooking);

  const clearList = useSetAtom(clearScannedItemsAtom);

  const itemsLength = Object.keys(items).length;
  const hasItems = itemsLength > 0;

  const [expanded, setExpanded] = useState(
    defaultExpanded !== undefined ? defaultExpanded : false
  );
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

  const [hasConflictsToResolve, Blockers] = useBlockers({
    assets,
    items,
    kits,
  });

  /** Clear the list on dismount */
  useEffect(
    () => () => {
      if (hasItems) {
        clearList();
      }
    },
    [clearList, hasItems]
  );

  const mode = useGlobalModeViaObserver();
  useEffect(() => {
    setExpanded(mode === "scanner");
  }, [mode]);

  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out lg:right-[20px]",
          minimizedSidebar ? "lg:left-[68px]" : "lg:left-[278px]",
          className
        )}
        style={{
          height: expanded
            ? mode === "scanner"
              ? vh - 400
              : vh - TOP_GAP
            : hasItems
            ? 170
            : 148,
        }}
      >
        <div className={tw("h-full")} style={style}>
          <div className="sr-only">Add assets and kits to booking via scan</div>

          <div className="mx-auto inline-flex size-full flex-col px-4 ">
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
              <ChevronUpIcon
                className={tw(
                  "mx-auto text-gray-500",
                  expanded && "rotate-180 "
                )}
              />
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
                className="-ml-4 flex max-h-full w-screen flex-col overflow-scroll md:ml-0 md:w-full"
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
                  <Blockers />

                  <When truthy={!!zo.errors.assetIds()?.message}>
                    <p className="text-sm text-error-500">
                      {zo.errors.assetIds()?.message}
                    </p>
                  </When>
                  <Form
                    ref={zo.ref}
                    className="mb-4 flex max-h-full w-full"
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
                        width="full"
                        type="submit"
                        disabled={isLoading || hasConflictsToResolve}
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
        item: { error: response.error.message },
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
  return (
    <div className="max-w-full">
      <p>
        QR id: <span className="font-semibold">{qrId}</span>
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
