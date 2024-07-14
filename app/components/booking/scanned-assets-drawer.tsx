import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  clearFetchedScannedAssetsAtom,
  fetchedScannedAssetsAtom,
  fetchedScannedAssetsCountAtom,
  removeFetchedScannedAssetAtom,
} from "~/atoms/bookings";
import { type loader } from "~/routes/_layout+/bookings.$bookingId_.scan-assets";
import { tw } from "~/utils/tw";
import { AvailabilityLabel } from "./availability-label";
import { AssetLabel } from "../icons/library";
import { ListHeader } from "../list/list-header";
import { Button } from "../shared/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTrigger,
} from "../shared/drawer";
import { Table, Td, Th } from "../table";
import When from "../when/when";

type ScannedAssetsDrawerProps = {
  className?: string;
  style?: React.CSSProperties;
};

export default function ScannedAssetsDrawer({
  className,
  style,
}: ScannedAssetsDrawerProps) {
  const { booking } = useLoaderData<typeof loader>();

  const fetchedScannedAssets = useAtomValue(fetchedScannedAssetsAtom);
  const fetchedScannedAssetsCount = useAtomValue(fetchedScannedAssetsCountAtom);
  const removeFetchedScannedAsset = useSetAtom(removeFetchedScannedAssetAtom);
  const clearFetchedScannedAssets = useSetAtom(clearFetchedScannedAssetsAtom);

  return (
    <Drawer>
      <DrawerTrigger>
        <Button>View assets</Button>
      </DrawerTrigger>

      <DrawerContent
        className={tw("min-h-[600px] overflow-y-hidden", className)}
        style={style}
      >
        <div className="mx-auto size-full md:max-w-4xl">
          <DrawerHeader className="flex items-center justify-between border-b text-left">
            <DrawerDescription>
              {fetchedScannedAssetsCount} assets scanned
            </DrawerDescription>

            <When truthy={fetchedScannedAssetsCount > 0}>
              <DrawerDescription
                className="cursor-pointer"
                onClick={clearFetchedScannedAssets}
              >
                Clear list
              </DrawerDescription>
            </When>
          </DrawerHeader>

          <When truthy={fetchedScannedAssetsCount === 0}>
            <div className="my-16 flex flex-col items-center px-3 text-center">
              <div className="mb-4 rounded-full bg-primary-50  p-2">
                <div className=" rounded-full bg-primary-100 p-2 text-primary">
                  <AssetLabel className="size-6" />
                </div>
              </div>

              <div>
                <div className="text-base font-semibold text-gray-900">
                  List is empty
                </div>
                <p className="text-sm text-gray-600">
                  Fill list by scanning codes...
                </p>
              </div>
            </div>
          </When>

          <When truthy={fetchedScannedAssetsCount > 0}>
            <div className="max-h-[600px] overflow-auto">
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
                                  isCheckedOut={asset.status === "CHECKED_OUT"}
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
                          }}
                        />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </When>

          <When truthy={fetchedScannedAssetsCount > 0}>
            <DrawerFooter className="flex-row">
              <DrawerClose asChild>
                <Button variant="outline" className="w-full max-w-full">
                  Close
                </Button>
              </DrawerClose>
              <Button className="w-full max-w-full">Confirm</Button>
            </DrawerFooter>
          </When>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr
      className="hover:bg-gray-50"
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
