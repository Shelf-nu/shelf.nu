/**
 * Where a web link the app shows goes when someone taps it.
 *
 * A link to Shelf's own web app (`app.shelf.nu`, or the server the app is
 * connected to) whose path names something the app has a screen for opens
 * that screen: an asset, kit, booking or audit, their lists, or a QR code
 * (resolved through the API). Every other http(s) link opens in the in-app
 * browser (SFSafariViewController on iOS, a Custom Tab on Android), never
 * through the OS: the person stays in the app, and dismissing the browser
 * returns them to the screen they tapped on. Files behind a link (PDF,
 * images, Office documents) open in that browser too.
 *
 * Shelf's own pages are never handed to the OS either: `app.shelf.nu` paths
 * are claimed App Links, and `Linking.openURL` of one re-enters this app
 * (see `.claude/rules/companion-deep-link-allowlist.md`). Links to other
 * websites carry `ref=shelf-companion`, the phone's twin of the
 * `ref=shelf-webapp` the web app adds to the links it opens. `@shelf/links`
 * leaves both refs out of a link's key, so a title stored for the link still
 * matches.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it. `openLink` in `./link-actions.ts` performs the opening.
 *
 * @see {@link file://./link-actions.ts} `openLink`
 * @see {@link file://./push/routing.ts} `toDestination`, the screen for a path
 * @see {@link file://../../webapp/app/utils/custom-field-link.ts} `buildCustomFieldLinkHref`
 * @see {@link file://./open-link.test.ts}
 */

import { toDestination, type PushDestination } from "./push/routing";
import { matchResourcePath, splitLinkUrl } from "./resource-path";

/**
 * The host the app claims for Universal Links and App Links (`app.json`).
 * Listed in `.claude/rules/companion-deep-link-allowlist.md`: change both
 * together.
 */
const CLAIMED_WEB_HOST = "app.shelf.nu";

const COMPANION_REF = "shelf-companion";

/**
 * Second path segments that are web-only pages, not ids, under a resource
 * the app has screens for (`/assets/import`, `/bookings/export`). The ones
 * the app's own routes reserve are in `NOT_A_DETAIL` (`./push/routing.ts`).
 */
const WEB_ONLY_PAGES: Readonly<Record<string, readonly string[]>> = {
  assets: ["export", "import", "import-update"],
  bookings: ["export"],
  kits: ["new"],
};

/** Where a link opens, and what to open. */
export type LinkOpening =
  /** A screen of this app: `pushIntoTab(tabRoot, href)`. */
  | ({ readonly opener: "screen" } & PushDestination)
  /** A Shelf QR code, resolved to its asset or kit through the API. */
  | { readonly opener: "qr"; readonly qrId: string; readonly origin: string }
  /** Any other page, shown in the in-app browser. */
  | { readonly opener: "browser"; readonly url: string };

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
 * Whether a URL is on Shelf's own web app: the claimed host, or the host
 * (and port) of the server the app is connected to. Compared lowercased
 * because the URL polyfill Expo installs on device keeps the host's case as
 * typed.
 */
function isShelfHost(parsed: URL, activeServerUrl: string): boolean {
  return (
    parsed.hostname.toLowerCase() === CLAIMED_WEB_HOST ||
    parsed.host.toLowerCase() ===
      parseWebUrl(activeServerUrl)?.host.toLowerCase()
  );
}

/** The app screen a Shelf web path names, or null for any other page. */
function screenForShelfPath(url: string): LinkOpening | null {
  const { segments } = splitLinkUrl(url);
  const match = matchResourcePath(segments);
  if (!match) return null;
  const [resource, page] = segments;
  if (page && WEB_ONLY_PAGES[resource]?.includes(page)) return null;

  if (match.resource === "qr") {
    return match.id
      ? { opener: "qr", qrId: match.id, origin: new URL(url).origin }
      : null;
  }
  const destination = toDestination(match);
  return destination ? { opener: "screen", ...destination } : null;
}

/**
 * Decides how to open a link.
 *
 * @param url - The link's absolute URL (as found by `findTextLinks`, or a
 *   note's Shelf link made absolute).
 * @param activeServerUrl - Base URL of the Shelf server the app is connected
 *   to; its host counts as Shelf's own web app, like `app.shelf.nu`.
 * @returns The screen, QR code or browser page to open, or null for anything
 *   that is not an http(s) URL (nothing should open).
 */
export function resolveLinkOpening(
  url: string,
  activeServerUrl: string
): LinkOpening | null {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;

  if (isShelfHost(parsed, activeServerUrl)) {
    return screenForShelfPath(url) ?? { opener: "browser", url };
  }

  if (!parsed.searchParams.getAll("ref").includes(COMPANION_REF)) {
    // Appending to the raw query keeps every existing parameter byte for
    // byte; rebuilding it through `searchParams` would re-encode them.
    const query = parsed.search ? `${parsed.search}&` : "?";
    parsed.search = `${query}ref=${COMPANION_REF}`;
  }
  return { opener: "browser", url: parsed.href };
}

/**
 * Whether a link leaves Shelf: it opens a page of another website in the
 * browser. Screens such links get a link chip under the text they appear
 * in; links to Shelf's own screens and pages stay inline.
 *
 * @param url - The link's absolute URL.
 * @param activeServerUrl - Base URL of the connected Shelf server.
 * @returns True for an http(s) link to a host other than Shelf's.
 */
export function isExternalLink(url: string, activeServerUrl: string): boolean {
  const parsed = parseWebUrl(url);
  return parsed !== null && !isShelfHost(parsed, activeServerUrl);
}
