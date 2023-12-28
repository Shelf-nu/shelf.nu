import { GEOCODE_API_KEY } from "./env";

export const geolocate = async (
  address: string | null
): Promise<{ lat: number; lon: number } | null> => {
  if (!address || address === "" || !GEOCODE_API_KEY) return null;
  // Create URL object and add the address to the url params
  const url = new URL("https://geocode.maps.co/search");
  url.searchParams.append("q", address);
  url.searchParams.append("api_key", GEOCODE_API_KEY);

  const request = await fetch(url.href);

  if (!request.ok) return null;
  const response = await request.json();
  /** Here we take the frist entry of the array.
   * When there are more entries that means the address is not accurate enought so we just take the first option
   */

  if (!response || response.length === 0) return null;

  const mapData = {
    lat: response[0].lat,
    lon: response[0].lon,
  };

  return mapData || null;
};
