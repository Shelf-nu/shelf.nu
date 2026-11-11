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
 * Reads the QR id out of a Shelf QR code, or answers `null` when the value is
 * not one. This is the one rule for "is this a Shelf QR". Shelf QR codes can be:
 * 1. Raw QR ID (e.g., "cm4abc123...")
 * 2. <app origin>/qr/{qrId} format (e.g., "https://app.shelf.nu/qr/cm4abc123")
 * 3. URL_SHORTENER/{qrId} format (e.g., "https://eam.sh/cm4abc123")
 *
 * A url on our host or shortener answers its id even when the id is not one
 * `isQrId` accepts, so the caller can report a malformed Shelf QR instead of
 * treating it as somebody else's code.
 *
 * Runs in both the server and the browser. The hosts it matches must be
 * readable in both, so each one comes from a public source.
 */
export function getShelfQrId(value: string): string | null {
  if (isQrId(value)) {
    return value;
  }

  const appOrigin = getAppOrigin();
  if (appOrigin) {
    const serverMatch = value.match(
      new RegExp(`^${escapeRegExp(appOrigin)}/qr/([a-zA-Z0-9]+)$`)
    );
    if (serverMatch) {
      return serverMatch[1];
    }
  }

  if (URL_SHORTENER) {
    const shortenerMatch = value.match(
      new RegExp(`^https://${escapeRegExp(URL_SHORTENER)}/([a-zA-Z0-9]+)$`)
    );
    if (shortenerMatch) {
      return shortenerMatch[1];
    }
  }

  return null;
}

/** Whether a scanned or typed value is a Shelf QR code; see `getShelfQrId`. */
export function isShelfQrCode(value: string): boolean {
  return getShelfQrId(value) !== null;
}
