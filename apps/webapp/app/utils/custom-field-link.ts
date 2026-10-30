/**
 * The href Shelf opens for a web link found in a custom field value.
 *
 * @see {@link file://./../components/links/link-chip.tsx}
 * @see {@link file://./../components/links/linked-text.tsx}
 * @see {@link file://./markdoc-linkify.ts}
 */

/**
 * Adds Shelf's `ref=shelf-webapp` attribution to a link, once. The rest of the
 * query stays exactly as written and the parameter goes before any fragment.
 *
 * @param url - An absolute http(s) URL, as read by `parseLink` or
 *   `segmentText` from `@shelf/links`
 * @returns The URL to put in the anchor's `href`
 */
export function buildCustomFieldLinkHref(url: string): string {
  const href = new URL(url);
  if (href.searchParams.getAll("ref").includes("shelf-webapp")) {
    return href.toString();
  }
  href.search = href.search
    ? `${href.search}&ref=shelf-webapp`
    : "ref=shelf-webapp";
  return href.toString();
}
