/* eslint-disable no-console */
import { config } from "~/config/shelf.config";

/**
 * How long to wait for Nominatim before giving up.
 *
 * The call is to a free third-party service and it is awaited inside a
 * user-facing loader, so it needs a deadline of its own. `fetch` has none by
 * default: a connection the upstream never answers is held until the socket
 * dies, and the request holds everything it had already taken with it.
 */
export const GEOCODING_TIMEOUT_MS = 5000;

// Geocoding using OpenStreetMap Nominatim (free service)
export const geolocate = async (
  address: string | null
): Promise<{ lat: number; lon: number } | null> => {
  if (!address || address === "") return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.append("q", address);
    url.searchParams.append("format", "json");
    url.searchParams.append("limit", "1");

    /**
     * An explicit controller rather than `AbortSignal.timeout`, for two reasons:
     * the timer can be cleared once an answer arrives, so a fast response leaves
     * nothing pending, and a plain `setTimeout` is observable, which is what lets
     * a test prove the deadline actually fires.
     */
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);

    try {
      const request = await fetch(url.href, {
        headers: {
          "User-Agent": config.geocoding.userAgent,
        },
        signal: controller.signal,
      });

      if (!request.ok) {
        console.error("Geocoding request failed:", request.status);
        return null;
      }

      const response = await request.json();

      if (!response || response.length === 0) {
        console.warn("No geocoding results found for address:", address);
        return null;
      }

      const mapData = {
        lat: parseFloat(response[0].lat),
        lon: parseFloat(response[0].lon),
      };

      return mapData;
    } finally {
      clearTimeout(deadline);
    }
  } catch (error) {
    // An abort arrives here too. Answering null is the same answer an
    // unresolvable address gives, so a slow upstream degrades the map rather
    // than failing the page that awaited it.
    console.error("Geocoding error:", error);
    return null;
  }
};
