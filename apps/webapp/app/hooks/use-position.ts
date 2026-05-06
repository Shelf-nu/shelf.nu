import { useEffect } from "react";
import { atom, useAtom } from "jotai";
import { useFetcher, useParams } from "react-router";
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
      // The error callback must be a function or omitted; passing `null` makes
      // WebKit throw a `TypeError: Argument 2 ('errorCallback') ... must be a
      // function`. Use `undefined` to opt out cleanly. The caller doesn't
      // surface geolocation errors anyway, so a no-op handler is unnecessary.
      navigator.geolocation.getCurrentPosition(
        (position) => setPosition(position.coords),
        undefined,
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
      void fetcher.submit(
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
