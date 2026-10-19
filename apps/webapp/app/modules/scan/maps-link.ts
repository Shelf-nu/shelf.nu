/**
 * Maps link
 *
 * The Google Maps link for a scan's location. The coordinates are stored as
 * strings, so they are encoded as one query value: a malformed stored value
 * can never add parameters to the link or move it off Google Maps.
 *
 * @see {@link file://./../../components/location/scan-details.tsx}
 * @see {@link file://./../../components/scan/scan-history-sheet.tsx}
 */

/**
 * The Google Maps search link for a pair of coordinates.
 *
 * @param latitude - The latitude as stored
 * @param longitude - The longitude as stored
 * @returns An https link to Google Maps centred on the point
 */
export function googleMapsSearchUrl(
  latitude: string,
  longitude: string
): string {
  const search = new URLSearchParams({
    api: "1",
    query: `${latitude.trim()},${longitude.trim()}`,
  });
  return `https://www.google.com/maps/search/?${search.toString()}`;
}
