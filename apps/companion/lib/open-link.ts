/**
 * How the app opens a web link a person stored on an asset.
 *
 * Shelf's own web pages open in the in-app browser (`openShelfWebUrl`), never
 * through the OS: `app.shelf.nu` paths are claimed App Links, and handing one
 * to `Linking.openURL` re-enters this app (see
 * `.claude/rules/companion-deep-link-allowlist.md`). Every other http(s) link
 * goes to the OS, so the OneDrive, Google Drive or Office app can take a
 * share link over, and carries `ref=shelf-companion`, the phone's twin of the
 * `ref=shelf-webapp` the web app adds to the custom field links it opens.
 * `@shelf/links` leaves both refs out of a link's key, so a title stored for
 * the link still matches.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it. `openExternalLink` in `./navigation.ts` performs the
 * opening.
 *
 * @see {@link file://./navigation.ts} `openExternalLink`, `openShelfWebUrl`
 * @see {@link file://../../webapp/app/utils/custom-field-link.ts} `buildCustomFieldLinkHref`
 * @see {@link file://./open-link.test.ts}
 */

/**
 * The host the app claims for Universal Links and App Links (`app.json`).
 * Listed in `.claude/rules/companion-deep-link-allowlist.md`: change both
 * together.
 */
const CLAIMED_WEB_HOST = "app.shelf.nu";

const COMPANION_REF = "shelf-companion";

/** Where a link opens, and the exact URL to open. */
export type LinkOpening =
  /** Shelf's own web app, shown in the in-app browser. */
  | { readonly opener: "shelf-browser"; readonly url: string }
  /** Any other website, handed to the OS and whichever app claims it. */
  | { readonly opener: "system"; readonly url: string };

function parseWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    const isWeb = parsed.protocol === "http:" || parsed.protocol === "https:";
    return isWeb && parsed.hostname !== "" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decides how to open a stored link.
 *
 * @param url - The link as stored (already found by `@shelf/links`).
 * @param activeServerUrl - Base URL of the Shelf server the app is connected
 *   to; its host counts as Shelf's own web app, like `app.shelf.nu`.
 * @returns The opener and URL, or null for anything that is not an http(s)
 *   URL (nothing should open).
 */
export function resolveLinkOpening(
  url: string,
  activeServerUrl: string
): LinkOpening | null {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;

  // Lowercased here because the URL polyfill Expo installs on device keeps the
  // host's case as typed.
  const host = parsed.host.toLowerCase();
  const isShelfWeb =
    parsed.hostname.toLowerCase() === CLAIMED_WEB_HOST ||
    host === parseWebUrl(activeServerUrl)?.host.toLowerCase();
  if (isShelfWeb) return { opener: "shelf-browser", url };

  if (!parsed.searchParams.getAll("ref").includes(COMPANION_REF)) {
    // Appending to the raw query keeps every existing parameter byte for
    // byte; rebuilding it through `searchParams` would re-encode them.
    const query = parsed.search ? `${parsed.search}&` : "?";
    parsed.search = `${query}ref=${COMPANION_REF}`;
  }
  return { opener: "system", url: parsed.href };
}
