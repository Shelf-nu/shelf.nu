/**
 * Builders for `/api/mobile` paths that carry a record id in the path.
 *
 * Record ids reach these builders from route params, and a route param can
 * come from a link opened outside the app. Every id is therefore written as
 * exactly one percent-encoded path segment, and every query value goes through
 * `URLSearchParams`, so an id can only ever select a record: it can never add
 * a query parameter, replace `orgId`, or point the request at a sibling
 * endpoint.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./paths.test.ts}
 * @see {@link file://./assets.ts}
 * @see {@link file://./audits.ts}
 * @see {@link file://./bookings.ts}
 * @see {@link file://./kits.ts}
 * @see {@link file://./asset-mutations.ts}
 */

/**
 * Encodes one value as a single path segment.
 *
 * @param value - A record id
 * @returns The id with every reserved character (`/`, `?`, `#`, `&`, `%`)
 *   percent-encoded
 */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Builds a query string from string values, skipping empty ones.
 *
 * @param params - Query parameters; `undefined`, `null` and `""` are left out
 * @returns The query string with its leading `?`, or `""` when nothing is set
 */
function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Mobile API paths whose path holds a record id. */
export const mobilePaths = {
  /**
   * @param assetId - The asset to read
   * @param orgId - The active workspace
   * @returns The asset detail path
   */
  asset: (assetId: string, orgId: string) =>
    `/api/mobile/assets/${pathSegment(assetId)}${query({ orgId })}`,

  /**
   * @param assetId - The asset whose bookings are listed
   * @param orgId - The active workspace
   * @param page - Pagination: `page` and `perPage`, both optional
   * @returns The asset bookings path
   */
  assetBookings: (
    assetId: string,
    orgId: string,
    page: { page?: number; perPage?: number } = {}
  ) =>
    `/api/mobile/assets/${pathSegment(assetId)}/bookings${query({
      orgId,
      page: page.page ? String(page.page) : undefined,
      perPage: page.perPage ? String(page.perPage) : undefined,
    })}`,

  /**
   * @param value - A scanned barcode value (any characters)
   * @param orgId - The active workspace
   * @returns The barcode resolve path
   */
  barcode: (value: string, orgId: string) =>
    `/api/mobile/barcode/${pathSegment(value)}${query({ orgId })}`,

  /**
   * The recording resolve: the server stores a scan. Used by the scanner tab
   * and by https QR links the OS delivers.
   *
   * @param codeId - A QR id or SAM id
   * @param orgId - The active workspace, which scopes a SAM id
   * @returns The recording QR resolve path
   */
  qr: (codeId: string, orgId?: string) =>
    `/api/mobile/qr/${pathSegment(codeId)}${query({ orgId })}`,

  /**
   * The non-recording resolve.
   *
   * @param codeId - A QR id or SAM id
   * @param orgId - The active workspace, which scopes a SAM id
   * @returns The non-recording resolve path
   */
  scannedItem: (codeId: string, orgId?: string) =>
    `/api/mobile/get-scanned-item/${pathSegment(codeId)}${query({ orgId })}`,

  /**
   * @param assetId - The asset whose main image is replaced
   * @param orgId - The active workspace
   * @returns The image upload path
   */
  assetImage: (assetId: string, orgId: string) =>
    `/api/mobile/asset/update-image${query({ orgId, assetId })}`,

  /**
   * @param auditId - The audit session to read
   * @param orgId - The active workspace
   * @returns The audit detail path
   */
  audit: (auditId: string, orgId: string) =>
    `/api/mobile/audits/${pathSegment(auditId)}${query({ orgId })}`,

  /**
   * @param auditId - The audit session whose notes and photos are read
   * @param orgId - The active workspace
   * @param auditAssetId - Narrows the result to one audited asset
   * @returns The audit evidence path
   */
  auditEvidence: (
    auditId: string,
    orgId: string,
    auditAssetId?: string | null
  ) =>
    `/api/mobile/audits/${pathSegment(auditId)}/evidence${query({
      orgId,
      auditAssetId,
    })}`,

  /**
   * @param bookingId - The booking to read
   * @param orgId - The active workspace
   * @returns The booking detail path
   */
  booking: (bookingId: string, orgId: string) =>
    `/api/mobile/bookings/${pathSegment(bookingId)}${query({ orgId })}`,

  /**
   * @param bookingId - The booking whose model reservations change
   * @param orgId - The active workspace
   * @returns The model reservations path
   */
  bookingModelRequests: (bookingId: string, orgId: string) =>
    `/api/mobile/bookings/${pathSegment(bookingId)}/model-requests${query({
      orgId,
    })}`,

  /**
   * @param kitId - The kit to read
   * @param orgId - The active workspace
   * @returns The kit detail path
   */
  kit: (kitId: string, orgId: string) =>
    `/api/mobile/kits/${pathSegment(kitId)}${query({ orgId })}`,
};
