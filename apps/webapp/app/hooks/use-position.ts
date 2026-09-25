import { useCallback, useEffect } from "react";
import { atom, useAtom } from "jotai";
import { useFetcher, useParams } from "react-router";
import { useSearchParams } from "~/hooks/search-params";

/**
 * The last fix obtained, tagged with the scan it was obtained for.
 *
 * The tag is what makes the value safe to keep in a module atom: the `qr+`
 * layout and its child route both mount this hook for one scan, so the atom is
 * shared on purpose, and it outlives the scan that filled it. A fix is only
 * ever reported for the scan it belongs to — an untagged position would be
 * posted against whichever scan came next, giving that record the coordinates
 * of wherever the previous one happened.
 */
type FixForScan = {
  scanId: string;
  coords: GeolocationCoordinates;
};

const positionAtom = atom<FixForScan | null>(null);

export const usePosition = () => {
  let { qrId } = useParams();
  const [searchParams] = useSearchParams();
  const [fix, setFix] = useAtom(positionAtom);
  const fetcher = useFetcher();
  const scanId = searchParams.get("scanId") as string;

  if (!qrId) {
    // If we don't have a qrId, we get it from the search params
    qrId = searchParams.get("qrId") as string;
  }

  /** The fix for the scan currently in the URL, or null when there is none. */
  const position = fix?.scanId === scanId ? fix.coords : null;

  useEffect(() => {
    if (navigator && navigator.geolocation && scanId) {
      // The error callback must be a function or omitted; passing `null` makes
      // WebKit throw a `TypeError: Argument 2 ('errorCallback') ... must be a
      // function`. Use `undefined` to opt out cleanly. The caller doesn't
      // surface geolocation errors anyway, so a no-op handler is unnecessary.
      navigator.geolocation.getCurrentPosition(
        (position) => setFix({ scanId, coords: position.coords }),
        undefined,
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    }
    // Keyed on the scan: a new scan needs its own fix, and asking again is the
    // only way to get one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

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

  /** Records a fix for the scan currently in the URL. */
  const setPosition = useCallback(
    (coords: GeolocationCoordinates) => setFix({ scanId, coords }),
    [scanId, setFix]
  );

  return [position, setPosition] as const;
};
