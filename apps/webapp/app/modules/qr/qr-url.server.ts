/**
 * @file The URL a Shelf QR code encodes.
 *
 * Kept apart from `./utils.server` (which pulls in the database and the QR
 * service) so CSV exports can print a code's URL without importing either.
 * The value is stable: it depends only on the code's id and the server's
 * shortener setting, never on the asset or kit the code is linked to.
 *
 * @see {@link file://./utils.server.ts} generateCode, which encodes this same URL
 * @see {@link file://../../../../docs/labels-export.md}
 */
import { SERVER_URL, URL_SHORTENER } from "~/utils/env";

/**
 * The URL prefix every QR code encodes: the shortener when one is configured
 * (production: `https://eam.sh`), otherwise this server's `/qr` route.
 *
 * @returns The prefix, without a trailing slash
 */
export function getQrBaseUrl() {
  return URL_SHORTENER ? `https://${URL_SHORTENER}` : `${SERVER_URL}/qr`;
}

/**
 * The full URL a QR code encodes, for exports and label files.
 *
 * @param qrId - The code's id; empty when the asset has no code
 * @returns `<base>/<qrId>`, or `""` when there is no id
 */
export function getQrUrl(qrId: string | null | undefined) {
  return qrId ? `${getQrBaseUrl()}/${qrId}` : "";
}
