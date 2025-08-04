import { SERVER_URL, URL_SHORTENER } from "~/utils/env";
import { isQrId } from "~/utils/id";

/**
 * Checks if a QR code value is a Shelf QR code
 * Shelf QR codes can be:
 * 1. Raw QR ID (e.g., "cm4abc123...")
 * 2. SERVER_URL/qr/{qrId} format (e.g., "https://shelf.nu/qr/cm4abc123")
 * 3. URL_SHORTENER/{qrId} format (e.g., "https://eam.sh/cm4abc123")
 */
export function isShelfQrCode(value: string): boolean {
  // Check if it's a raw QR ID
  if (isQrId(value)) {
    return true;
  }

  // Check if it matches SERVER_URL/qr/{qrId} pattern
  if (SERVER_URL) {
    const serverPattern = new RegExp(
      `^${SERVER_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/qr/([a-zA-Z0-9]+)$`
    );
    if (serverPattern.test(value)) {
      return true;
    }
  }

  // Check if it matches URL_SHORTENER/{qrId} pattern
  if (URL_SHORTENER) {
    const shortenerPattern = new RegExp(
      `^https://${URL_SHORTENER.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}/([a-zA-Z0-9]+)$`
    );
    if (shortenerPattern.test(value)) {
      return true;
    }
  }

  return false;
}
