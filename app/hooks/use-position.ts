import { useEffect } from "react";
import { useFetcher, useParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { useSearchParams } from "~/hooks/search-params";

const positionAtom = atom<GeolocationCoordinates | null>(null);

export const usePosition = () => {
  let { qrId } = useParams();
  const [searchParams] = useSearchParams();
  const [position, setPosition] = useAtom(positionAtom);
  const fetcher = useFetcher();
  const scanId = searchParams.get("scanId") as string;

  if (!qrId) {
    // If we don't have a qrId, we get it from the search params
    qrId = searchParams.get("qrId") as string;
  }

  useEffect(() => {
    if (navigator && navigator.geolocation && scanId) {
      navigator.geolocation.getCurrentPosition(
        // Success function
        (position) => setPosition(position.coords),
        // Error function
        null,
        // Options. See MDN for details.
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (position && scanId) {
      // Here we update the position
      fetcher.submit(
        {
          latitude: position.latitude.toString(),
          longitude: position.longitude.toString(),
          scanId: scanId,
        },
        { method: "post", action: `/qr/${qrId}` }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  return [position, setPosition];
};
