import { useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { ShelfMap } from "./map";
import { MapPlaceholder } from "./map-placeholder";

export function ScanDetails() {
  const { lastScan } = useLoaderData<typeof loader>();
  let latitude, longitude;

  const hasLocation = lastScan?.coordinates !== "Unknown location";

  if (hasLocation) {
    latitude = lastScan?.coordinates.split(",")[0];
    longitude = lastScan?.coordinates.split(",")[1];
  }

  return (
    <div className="mb-8 border lg:mb-0">
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
            <h5 className="mb-1">Last scan location data</h5>
            <p>Coordinates: {lastScan.coordinates}</p>
            <p>Date/Time: {lastScan.dateTime}</p>
            <p>
              Device:{" "}
              {lastScan.ua.device.name
                ? lastScan.ua.device.name
                : "Unknown device"}
            </p>
            <p>Browser: {lastScan.ua.browser.name}</p>
            <p>Operating System: {lastScan.ua.os.name}</p>
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
