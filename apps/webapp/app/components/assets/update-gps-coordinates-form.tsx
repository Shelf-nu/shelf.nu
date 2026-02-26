import type { MouseEvent } from "react";
import { useFetcher, useParams } from "react-router";
import { useClientNotification } from "~/hooks/use-client-notification";
import type { action } from "~/routes/api+/asset.scan";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { Button } from "../shared/button";

interface Coordinates {
  latitude: number;
  longitude: number;
}

export const UpdateGpsCoordinatesForm = ({
  callback,
}: {
  callback: () => void;
}) => {
  const fetcher = useFetcher<typeof action>();
  const { assetId } = useParams();
  const [sendNotification] = useClientNotification();

  function requestGeoCoordinates() {
    return new Promise<Coordinates>((resolve, reject) => {
      if (navigator && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          // Success function
          (position) => {
            const coords = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            resolve(coords);
          },
          // Error function
          () => {
            sendNotification({
              title: "Location permissions blocked",
              message:
                "Please give your browser permission to access GPS coordinates.",
              icon: { name: "trash", variant: "error" },
            });
            reject();
          },
          // Options. See MDN for details.
          {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0,
          }
        );
      } else {
        reject();
      }
    });
  }

  async function handleSubmit(e: MouseEvent<HTMLButtonElement>) {
    callback();

    e.preventDefault();
    try {
      const coords = await requestGeoCoordinates();

      void fetcher.submit(
        {
          assetId: assetId as string,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
          manuallyGenerated: "yes",
        },
        {
          method: "POST",
          action: "/api/asset/scan",
        }
      );
    } catch {
      // We dont need to do anything here because we are already showing a notification when the location permissions are rejected
    }
  }

  return (
    <Button
      variant="link"
      className={tw(
        "justify-start px-4 py-3 text-color-700 hover:bg-slate-100 hover:text-color-700"
      )}
      width="full"
      onClick={handleSubmit}
    >
      <span className="flex items-center gap-2">
        <Icon icon="gps" /> Update GPS coordinates
      </span>
    </Button>
  );
};
