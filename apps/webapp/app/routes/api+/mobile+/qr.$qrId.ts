import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { createScan } from "~/modules/scan/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Optional scan geolocation carried on the resolve request's query string.
 *
 * Coordinates only make sense as a pair, so both must be present and valid for
 * either to be used. Each must be a non-empty, finite decimal within its
 * coordinate range (lat −90..90, lng −180..180). `z.coerce.number()` is
 * deliberately avoided: it coerces `""` to `0`, which would turn an empty
 * `?latitude=&longitude=` into a plausible-looking scan at 0,0 ("Null Island").
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
 * Parses the optional `latitude`/`longitude` query params into the string
 * format the `Scan` model stores (`String(number)` — identical to the web
 * flow, which posts `position.coords.latitude.toString()` with no rounding).
 *
 * Invalid or partial coordinates are IGNORED, never an error: geolocation is
 * best-effort provenance and must not be able to break a resolve (matching the
 * non-fatal `createScan` catch below).
 *
 * @param searchParams - The resolve request's query params.
 * @returns Normalized coordinate strings, or `null` when absent/invalid.
 */
function parseScanGeolocation(
  searchParams: URLSearchParams
): { latitude: string; longitude: string } | null {
  // Both absent is the common no-GPS case — skip the parse entirely.
  if (!searchParams.has("latitude") && !searchParams.has("longitude")) {
    return null;
  }

  const parsed = ScanGeolocationSchema.safeParse({
    latitude: searchParams.get("latitude"),
    longitude: searchParams.get("longitude"),
  });
  if (!parsed.success) return null;

  return {
    latitude: String(parsed.data.latitude),
    longitude: String(parsed.data.longitude),
  };
}

/**
 * GET /api/mobile/qr/:qrId
 *
 * The **recording** mobile code resolve. Resolves a scanned QR id or SAM id to
 * its linked asset/kit (via {@link resolveMobileScannedCode}) and records scan
 * provenance (who + when + optional where) for a real QR field scan, mirroring
 * the public web QR resolver (`qr+/_public+/$qrId.tsx`).
 *
 * Recording is unconditional here: it is an endpoint-level property, NOT a
 * client-supplied flag. Callers that only need to identify a code without
 * recording use the sibling non-recording route instead (the audit scanner),
 * mirroring the web's `get-scanned-item` split. SAM resolves have no backing QR
 * id, so nothing is recorded (matching web).
 *
 * Optional query params:
 * - `latitude` / `longitude` — best-effort GPS coordinates captured by the
 *   companion at scan time (decimal degrees; lat −90..90, lng −180..180).
 *   Stored on the scan record like the web flow's geolocation post. The web
 *   needs a separate authenticated follow-up POST (`updateScanGeolocation`)
 *   because its scan is created before the browser can ask for position; the
 *   companion already has a cached position when it fires the resolve, so the
 *   coordinates ride along and are persisted atomically via `createScan`.
 *   Invalid or partial coordinates are silently ignored — provenance must
 *   never break a resolve.
 *
 * Used by the companion scanner tab and deep-link handler.
 *
 * @see {@link file://./get-scanned-item.$qrId.ts} (the non-recording sibling)
 * @see {@link file://./../../qr+/_public+/$qrId.tsx} (the web recording resolve)
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);

    const result = await resolveMobileScannedCode({ request, params, user });
    if (!result.ok) {
      return data(
        {
          error: {
            message: result.message,
            // Additive structured discriminator (e.g. "unclaimed") + the
            // scanned QR id, so the companion can branch into the native
            // claim flow without string-matching the message.
            ...(result.reason
              ? { reason: result.reason, qrId: result.qrId }
              : {}),
          },
        },
        { status: result.status }
      );
    }

    // Record scan provenance for a real QR field scan. SAM resolves expose no
    // QR id (`recordableQrId === null`), so there is nothing to record.
    // Non-fatal: a provenance failure must never turn a successful resolve into
    // an error response for the scanner.
    if (result.recordableQrId) {
      // Best-effort GPS from the companion; null when absent or invalid.
      const geolocation = parseScanGeolocation(
        new URL(request.url).searchParams
      );

      try {
        await createScan({
          userAgent: request.headers.get("user-agent") ?? "mobile-companion",
          userId: user.id,
          qrId: result.recordableQrId,
          deleted: false,
          ...(geolocation ?? {}),
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to record mobile scan provenance",
            // why: qrId is enough to trace the failing scan; avoid putting a
            // raw user identifier into the log pipeline.
            additionalData: { qrId: result.recordableQrId },
            label: "Scan",
          })
        );
      }
    }

    return data({ qr: result.qr });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
