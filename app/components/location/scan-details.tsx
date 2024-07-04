import type { SerializeFrom } from "@remix-run/node";
import { Button } from "~/components/shared/button";
import type { parseScanData } from "~/modules/scan/utils.server";
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
          <div className="p-4 text-text-xs text-gray-600">
            <h5 className="mb-1">Last location data</h5>
            <p>Coordinates: {lastScan.coordinates}</p>
            <p>Date/Time: {lastScan.dateTime}</p>
            <p>
              Device:{" "}
              {lastScan.ua.device.model && lastScan.ua.device.vendor
                ? `${lastScan.ua.device.vendor} - ${lastScan.ua.device.model}`
                : "Unknown device"}
            </p>
            <p>Browser: {lastScan.ua.browser.name}</p>
            <p>Operating System: {lastScan.ua.os.name}</p>
            <div className="flex items-center">
              <p className="inline-block max-w-xs truncate">
                Scanned By: {lastScan.scannedBy}
              </p>
            </div>
            <div>
              Source:{" "}
              {lastScan.manuallyGenerated ? "Manually updated" : "QR code scan"}{" "}
              <InfoTooltip
                icon={<HelpIcon />}
                content={
                  <>
                    <h6 className="mb-1 text-sm font-semibold text-gray-700">
                      Source of location data
                    </h6>
                    <p className="text-xs font-medium text-gray-500">
                      The location data can be generated in 2 different ways:
                    </p>
                    <ul className="text-xs font-medium text-gray-500 ">
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
            </div>
            {hasLocation ? (
              <p className="mt-1">
                <Button
                  to={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}&zoom=15&markers=${latitude},${longitude}`}
                  variant="link"
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                >
                  See in Google Maps
                </Button>
              </p>
            ) : null}
          </div>
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
