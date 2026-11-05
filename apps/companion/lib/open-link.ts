/**
 * Where a web link the app shows goes when someone taps it.
 *
 * A link to the Shelf server the app is connected to (`app.shelf.nu` for
 * Shelf's cloud) never opens a browser. When its path names something the
 * app has a screen for (an asset, kit, booking or audit, or their lists) it
 * opens that screen; a Shelf QR link resolves through the API to its asset
 * or kit. Any other page on that server (a location, settings, a page of
 * another workspace) is `web-only`: the in-app browser holds no Shelf
 * session and would only show the web login, so the caller explains instead.
 *
 * Every other http(s) link opens in the in-app browser (SFSafariViewController
 * on iOS, a Custom Tab on Android), never through the OS: the person stays in
 * the app, and dismissing the browser returns them to the screen they tapped
 * on. Files behind a link (PDF, images, Office documents) open there too, and
 * so does a link to another Shelf server (cloud while self-hosted), whose ids
 * mean nothing to the connected one.
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
 * MIRROR of the webapp's static routes beside the `$id` routes under
 * `apps/webapp/app/routes/_layout+/` (`assets.export`, `assets.import`,
 * `assets.import-update`, `bookings.export`, `kits.new`): second path
 * segments that name a web page, not an id. Cosmetic only: a page missing
 * here opens a detail screen that reports "not found", nothing more. The
 * ones the app's own routes reserve are in `NOT_A_DETAIL`
 * (`./push/routing.ts`). Extraction target: a pure `packages/*` routes
 * module (none yet). Add a new static web page under these resources here.
 */
const WEB_ONLY_PAGES: Readonly<Record<string, readonly string[]>> = {
  assets: ["export", "import", "import-update"],
  bookings: ["export"],
  kits: ["new"],
};

/** What the caller knows about where the link was tapped. */
export type LinkContext = {
  /** The workspace the app is showing; a link naming another is web-only. */
  readonly currentOrgId?: string | null;
};

/** Why a page on the connected Shelf server cannot open in the app. */
export type WebOnlyReason =
  /** The app has no screen for the page (a location, settings, an export). */
  | "no-screen"
  /** The page belongs to another workspace than the one the app shows. */
  | "other-workspace"
  /** A tapped QR link names no asset or kit the app can open. */
  | "qr-unresolved";

/** Where a link opens, and what to open. */
export type LinkOpening =
  /** A screen of this app: `pushIntoTab(tabRoot, href)`. */
  | ({ readonly opener: "screen" } & PushDestination)
  /** A Shelf QR code, resolved to its asset or kit through the API. */
  | { readonly opener: "qr"; readonly qrId: string; readonly origin: string }
  /** A page of the connected Shelf server that only the web app shows. */
  | {
      readonly opener: "web-only";
      readonly url: string;
      readonly reason: WebOnlyReason;
    }
  /** Any other page, shown in the in-app browser. */
  | { readonly opener: "browser"; readonly url: string };

/**
 * The URL when it is an http(s) URL with a host, otherwise null.
 *
 * @param url - Any string.
 * @returns The parsed URL, or null.
 */
export function parseWebUrl(url: string): URL | null {
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
    isActiveServerHost(parsed, activeServerUrl)
  );
}

/** Whether a URL is on the server the app is connected to, port included. */
function isActiveServerHost(parsed: URL, activeServerUrl: string): boolean {
  return (
    parsed.host.toLowerCase() ===
    parseWebUrl(activeServerUrl)?.host.toLowerCase()
  );
}

/**
 * Where a link on a Shelf host goes: its app screen or QR code, `web-only`
 * for another page of the connected server, or null for a page of another
 * Shelf server (the browser shows it).
 *
 * @param url - The link, on a Shelf host.
 * @param onActiveServer - Whether the link's host is the connected server;
 *   ids from another Shelf server mean nothing to this one.
 * @param context - Where the link was tapped.
 */
function shelfDestination(
  url: string,
  onActiveServer: boolean,
  context: LinkContext
): LinkOpening | null {
  const webOnly = (reason: WebOnlyReason): LinkOpening | null =>
    onActiveServer ? { opener: "web-only", url, reason } : null;
  const { segments, query } = splitLinkUrl(url);
  const match = matchResourcePath(segments);
  if (!match) return webOnly("no-screen");
  const [resource, page] = segments;
  if (page && WEB_ONLY_PAGES[resource]?.includes(page)) {
    return webOnly("no-screen");
  }

  if (match.resource === "qr") {
    // The resolver hands a code from another server to that server's web.
    return match.id
      ? {
          opener: "qr",
          qrId: match.id,
          // why: lowercased because the URL polyfill on device keeps the
          // host's case as typed, and the origin is compared with the
          // connected server's.
          origin: new URL(url).origin.toLowerCase(),
        }
      : webOnly("no-screen");
  }
  if (!onActiveServer) return null;
  const linkOrgId = new URLSearchParams(query).get("orgId")?.trim();
  if (linkOrgId && context.currentOrgId && linkOrgId !== context.currentOrgId) {
    // The web app switches workspace for a link like this; the screen would
    // look the id up in the workspace the app is showing.
    return webOnly("other-workspace");
  }
  const destination = toDestination(match);
  return destination
    ? { opener: "screen", ...destination }
    : webOnly("no-screen");
}

/**
 * Decides how to open a link.
 *
 * @param url - The link's absolute URL (as found by `findTextLinks`, or a
 *   note's Shelf link made absolute).
 * @param activeServerUrl - Base URL of the Shelf server the app is connected
 *   to; its host counts as Shelf's own web app, like `app.shelf.nu`.
 * @param context - Where the link was tapped (the workspace on show).
 * @returns The screen, QR code, web-only notice or browser page to open, or
 *   null for anything that is not an http(s) URL (nothing should open).
 */
export function resolveLinkOpening(
  url: string,
  activeServerUrl: string,
  context: LinkContext = {}
): LinkOpening | null {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;

  if (isShelfHost(parsed, activeServerUrl)) {
    const onActiveServer = isActiveServerHost(parsed, activeServerUrl);
    return (
      shelfDestination(url, onActiveServer, context) ?? {
        opener: "browser",
        url,
      }
    );
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
 * Whether a Shelf link opens something in the app: a screen, or a QR code
 * resolved to one. A Shelf page the app has no screen for (a team member,
 * a location, settings) does not. A link the app writes itself, such as a
 * note's `link` tag, links only when this is true; a link someone typed
 * stays tappable and explains itself (`web-only`).
 *
 * @param url - The link's absolute URL.
 * @param activeServerUrl - Base URL of the connected Shelf server.
 * @returns True when tapping the link opens an app screen.
 */
export function opensInApp(url: string, activeServerUrl: string): boolean {
  const opening = resolveLinkOpening(url, activeServerUrl);
  return opening?.opener === "screen" || opening?.opener === "qr";
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
