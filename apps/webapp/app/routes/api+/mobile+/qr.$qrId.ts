import { ScanSource } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { parseScanGeolocation } from "~/modules/scan/geolocation.server";
import { recordScanNonFatal } from "~/modules/scan/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/qr/:qrId
 *
 * The **recording** mobile code resolve. Resolves a scanned QR id or SAM id
 * (with a SAM-shaped barcode fallback) to its linked asset/kit (via
 * {@link resolveMobileScannedCode}) and records the scan (who + when +
 * optional where) as `COMPANION`, with a note on a scanned asset, mirroring
 * the public web QR resolver (`qr+/_public+/$qrId.tsx`).
 *
 * Recording is unconditional here: it is an endpoint-level property, NOT a
 * client-supplied flag. Callers that only need to identify a code without
 * recording use the sibling non-recording route instead (the audit scanner),
 * whose scans the audit writer records.
 *
 * Optional headers:
 * - `X-Scan-Latitude` / `X-Scan-Longitude` — best-effort GPS coordinates captured by the
 *   companion at scan time (decimal degrees; lat −90..90, lng −180..180).
 *   Stored on the scan record like the web flow's geolocation post. The web
 *   needs a separate authenticated follow-up POST (`updateScanGeolocation`)
 *   because its scan is created before the browser can ask for position; the
 *   companion already has a cached position when it fires the resolve, so the
 *   coordinates ride along and are persisted with the scan row.
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

    // Record the scan against what the code resolved to. Non-fatal: a
    // provenance failure must never turn a successful resolve into an error
    // response for the scanner.
    await recordScanNonFatal({
      ...result.scanToRecord,
      // The value exactly as scanned: a SAM ID is normalized and a barcode
      // matched case-insensitively, and the row records what the label says.
      code: getParams(params, z.object({ qrId: z.string() })).qrId,
      source: ScanSource.COMPANION,
      userAgent: request.headers.get("user-agent") ?? "mobile-companion",
      userId: user.id,
      // Best-effort GPS from the companion; absent when missing or invalid.
      ...(parseScanGeolocation(request.headers) ?? {}),
      writeNote: true,
    });

    return data({ qr: result.qr });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
