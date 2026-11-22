/**
 * The link that opens an asset's PDF attachment.
 *
 * Pages never hold a signed Storage URL for an attachment. They link to the
 * viewing route, which checks permission on each click and redirects to a URL
 * that lives for a minute.
 *
 * @see {@link file://./../routes/api+/asset.$assetId.attachment.ts} `loader`
 */

/**
 * Builds the link that opens an asset's attachment.
 *
 * @param assetId - The asset's id, or the create form's placeholder id while
 *   the file is staged
 * @returns The viewing route's path
 */
export function assetAttachmentHref(assetId: string): string {
  return `/api/asset/${encodeURIComponent(assetId)}/attachment`;
}
