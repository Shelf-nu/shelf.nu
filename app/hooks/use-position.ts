import { useEffect } from "react";
import { useFetcher, useParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";

const positionAtom = atom<GeolocationCoordinates | null>(null);

export const usePosition = () => {
  const { qrId } = useParams();
  const [position, setPosition] = useAtom(positionAtom);
  const fetcher = useFetcher();

  useEffect(() => {
    if (navigator && navigator.geolocation) {
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
  }, []);

  useEffect(() => {
    if (position) {
      // Here we update the position
      console.log(position);
      fetcher.submit(
        {
          latitude: position.latitude.toString(),
          longitude: position.longitude.toString(),
        },
        { method: "post", action: `/qr/${qrId}` }
      );
    }
  }, [position]);

  return [position, setPosition];
};
