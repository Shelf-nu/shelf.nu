import { data, type LoaderFunctionArgs } from "react-router";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/get-scanned-item/:qrId
 *
 * The **non-recording** mobile code resolve. Resolves a scanned QR id or SAM id
 * to its linked asset/kit (via {@link resolveMobileScannedCode}) WITHOUT
 * recording scan provenance, mirroring the web's `api+/get-scanned-item.$qrId`.
 *
 * Used by the companion **audit scanner**: an audit only needs to identify the
 * code (it records its own `AuditScan` separately), so it must not add an
 * ad-hoc scan to the asset's "last scanned" history. Because recording is an
 * endpoint-level property, there is no client flag here to record or suppress,
 * which is exactly what keeps the recording decision off attacker-controlled
 * input.
 *
 * @see {@link file://./qr.$qrId.ts} (the recording sibling)
 * @see {@link file://./../../get-scanned-item.$qrId} (the web non-recording resolve)
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

    // Identify only — never records a scan.
    return data({ qr: result.qr });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
