/* eslint-disable no-console */
import { config } from "~/config/shelf.config";

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

    const request = await fetch(url.href, {
      headers: {
        "User-Agent": config.geocoding.userAgent,
      },
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
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
};
