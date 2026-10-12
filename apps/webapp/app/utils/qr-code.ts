import { SERVER_URL, URL_SHORTENER } from "~/utils/env";
import { isQrId } from "~/utils/id";
import { isBrowser } from "~/utils/is-browser";

/** Escapes a literal string for use inside a RegExp. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The origin Shelf QR links point at.
 *
 * `SERVER_URL` is not shipped to the browser (`getEnv` answers `""` there), so
 * the browser uses its own origin: the app is served from the address its
 * labels link to. The camera scanner runs client-side, so this branch is the
 * one that classifies every scanned label.
 */
function getAppOrigin(): string {
  return isBrowser ? window.location.origin : SERVER_URL;
}

/**
 * Checks if a QR code value is a Shelf QR code
 * Shelf QR codes can be:
 * 1. Raw QR ID (e.g., "cm4abc123...")
 * 2. <app origin>/qr/{qrId} format (e.g., "https://app.shelf.nu/qr/cm4abc123")
 * 3. URL_SHORTENER/{qrId} format (e.g., "https://eam.sh/cm4abc123")
 *
 * Runs in both the server and the browser. The hosts it matches must be
 * readable in both, so each one comes from a public source.
 */
export function isShelfQrCode(value: string): boolean {
  // Check if it's a raw QR ID
  if (isQrId(value)) {
    return true;
  }

  // Check if it matches <app origin>/qr/{qrId}
  const appOrigin = getAppOrigin();
  if (appOrigin) {
    const serverPattern = new RegExp(
      `^${escapeRegExp(appOrigin)}/qr/([a-zA-Z0-9]+)$`
    );
    if (serverPattern.test(value)) {
      return true;
    }
  }

  // Check if it matches URL_SHORTENER/{qrId} pattern
  if (URL_SHORTENER) {
    const shortenerPattern = new RegExp(
      `^https://${escapeRegExp(URL_SHORTENER)}/([a-zA-Z0-9]+)$`
    );
    if (shortenerPattern.test(value)) {
      return true;
    }
  }

  return false;
}
