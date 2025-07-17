import type { SerializeFrom } from "@remix-run/node";
import { Button } from "~/components/shared/button";
import type { parseScanData } from "~/modules/scan/utils.server";
import { tw } from "~/utils/tw";
import { ShelfMap } from "./map";
import { MapPlaceholder } from "./map-placeholder";
import { HelpIcon } from "../icons/library";
import { InfoTooltip } from "../shared/info-tooltip";

export function ScanDetails({
  lastScan,
}: {
  lastScan?: SerializeFrom<ReturnType<typeof parseScanData>> | null;
}) {
  let latitude, longitude;

  const hasLocation = lastScan?.coordinates !== "Unknown location";

  if (hasLocation) {
    latitude = lastScan?.coordinates.split(",")[0];
    longitude = lastScan?.coordinates.split(",")[1];
  }

  return (
    <div className="mt-4 rounded-md border lg:mb-0">
      {lastScan ? (
        <>
          {" "}
          <div className="overflow-hidden border-b">
            {hasLocation ? (
              <ShelfMap
                latitude={parseFloat(latitude as string)}
                longitude={parseFloat(longitude as string)}
              />
            ) : (
              <MapPlaceholder />
            )}
          </div>
          <div
            className={tw(
              "border-b-[1.1px] p-4 text-text-xs text-color-600",
              "[&>div>p:first-child]:text-xs [&>div>p:first-child]:font-medium [&>div>p:first-child]:text-color-900", // Styles for left column
              "[&>div>p:last-child]:text-right [&>div>p:last-child]:text-sm [&>div>p:last-child]:font-normal [&>div>p:last-child]:text-color-600" // Styles for right column
            )}
          >
            <div className="flex justify-between py-2">
              <p>Date/Time</p>
              <p>{lastScan.dateTime}</p>
            </div>
            <div className="flex justify-between py-2">
              <p>Coordinates</p>
              <p>{lastScan.coordinates}</p>
            </div>
            <div className="flex justify-between py-2">
              <p>Device</p>
              <p>
                {lastScan.ua.device.model && lastScan.ua.device.vendor
                  ? `${lastScan.ua.device.vendor} - ${lastScan.ua.device.model}`
                  : "Unknown device"}
              </p>
            </div>
            <div className="flex justify-between py-2">
              <p>Browser</p>
              <p>{lastScan.ua.browser.name}</p>
            </div>
            <div className="flex justify-between py-2">
              <p>OS</p>
              <p>{lastScan.ua.os.name}</p>
            </div>
            <div className="flex justify-between py-2">
              <p>Scanned By</p>
              <p>{lastScan.scannedBy}</p>
            </div>
            <div className="flex justify-between pt-2">
              <p>Source</p>
              <p>
                {lastScan.manuallyGenerated
                  ? "Manually updated"
                  : "QR code scan"}{" "}
                <InfoTooltip
                  icon={<HelpIcon />}
                  content={
                    <>
                      <h6 className="mb-1 text-sm font-semibold text-color-700">
                        Source of location data
                      </h6>
                      <p className="text-xs font-medium text-color-500">
                        The location data can be generated in 2 different ways:
                      </p>
                      <ul className="text-xs font-medium text-color-500 ">
                        <li>
                          <strong>1. Manually updated:</strong> User manually
                          updated the location data.
                        </li>
                        <li>
                          <strong>2. QR code scan:</strong> User scanned the QR
                          code of the asset.
                        </li>
                      </ul>
                    </>
                  }
                />
              </p>
            </div>
          </div>
          {hasLocation ? (
            <div className="flex w-full justify-center px-4 py-3">
              <Button
                to={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}&zoom=15&markers=${latitude},${longitude}`}
                variant="secondary"
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="w-full"
              >
                See in Google Maps
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <MapPlaceholder
          title="Waiting for first QR code scan"
          description="Scan your asset’s QR code with a phone, grant location permissions. Wait a few seconds and see the first scan location on a map!"
        />
      )}
    </div>
  );
}
