/**
 * Scan geolocation headers
 *
 * The companion app sends the device's position with a resolve as
 * `X-Scan-Latitude` / `X-Scan-Longitude`. This parses them into the string
 * format the `Scan` model stores.
 *
 * @see {@link file://./../../routes/api+/mobile+/qr.$qrId.ts}
 * @see {@link file://./../../routes/api+/mobile+/barcode.$value.ts}
 */
import { z } from "zod";

/**
 * Optional scan geolocation carried on the resolve request's headers.
 *
 * Coordinates only make sense as a pair, so both must be present and valid for
 * either to be used. Each must be a non-empty, finite decimal within its
 * coordinate range (lat −90..90, lng −180..180). `z.coerce.number()` is
 * deliberately avoided: it coerces `""` to `0`, which would turn a pair of
 * empty headers into a plausible-looking scan at 0,0 ("Null Island").
 */
const ScanGeolocationSchema = z.object({
  latitude: z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v >= -90 && v <= 90),
  longitude: z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v >= -180 && v <= 180),
});

/**
 * Parses the optional `X-Scan-Latitude`/`X-Scan-Longitude` headers into the string
 * format the `Scan` model stores (`String(number)`, identical to the web
 * flow, which posts `position.coords.latitude.toString()` with no rounding).
 *
 * Invalid or partial coordinates are IGNORED, never an error: geolocation is
 * best-effort provenance and must not be able to break a resolve (matching the
 * non-fatal scan record in the routes that read it).
 *
 * Headers, deliberately NOT query params: URL query strings are captured
 * verbatim by access logs, proxies, and Sentry's request breadcrumbs, which
 * would write precise user GPS into every log pipeline. Headers keep the
 * coordinates out of every URL-shaped capture surface.
 *
 * @param headers - The resolve request's headers.
 * @returns Normalized coordinate strings, or `null` when absent/invalid.
 */
export function parseScanGeolocation(
  headers: Headers
): { latitude: string; longitude: string } | null {
  const latitude = headers.get("x-scan-latitude");
  const longitude = headers.get("x-scan-longitude");

  // Both absent is the common no-GPS case: skip the parse entirely.
  if (latitude === null && longitude === null) {
    return null;
  }

  const parsed = ScanGeolocationSchema.safeParse({
    latitude,
    longitude,
  });
  if (!parsed.success) return null;

  return {
    latitude: String(parsed.data.latitude),
    longitude: String(parsed.data.longitude),
  };
}
