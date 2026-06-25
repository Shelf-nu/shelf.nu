import { data, type LoaderFunctionArgs } from "react-router";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { createScan } from "~/modules/scan/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * GET /api/mobile/qr/:qrId
 *
 * The **recording** mobile code resolve. Resolves a scanned QR id or SAM id to
 * its linked asset/kit (via {@link resolveMobileScannedCode}) and records scan
 * provenance (who + when) for a real QR field scan, mirroring the public web QR
 * resolver (`qr+/_public+/$qrId.tsx`).
 *
 * Recording is unconditional here: it is an endpoint-level property, NOT a
 * client-supplied flag. Callers that only need to identify a code without
 * recording use the sibling non-recording route instead (the audit scanner),
 * mirroring the web's `get-scanned-item` split. SAM resolves have no backing QR
 * id, so nothing is recorded (matching web). GPS coordinates are intentionally
 * NOT captured here (a separate, deliberate item).
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
        { error: { message: result.message } },
        { status: result.status }
      );
    }

    // Record scan provenance for a real QR field scan. SAM resolves expose no
    // QR id (`recordableQrId === null`), so there is nothing to record.
    // Non-fatal: a provenance failure must never turn a successful resolve into
    // an error response for the scanner.
    if (result.recordableQrId) {
      try {
        await createScan({
          userAgent: request.headers.get("user-agent") ?? "mobile-companion",
          userId: user.id,
          qrId: result.recordableQrId,
          deleted: false,
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
