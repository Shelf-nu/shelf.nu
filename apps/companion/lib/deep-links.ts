import { useEffect } from "react";
import * as Linking from "expo-linking";
import { accountGeneration, api, getApiBaseUrl } from "./api";
import { linkAction } from "./link-routing";
import { openLinkedRoute, openShelfWebUrl, pushIntoTab } from "./navigation";
import {
  resolveQrOutcome,
  type QrLookups,
  type QrOutcome,
} from "./link-dispatch";
import {
  matchResourcePath,
  queryIdsArePlain,
  splitLinkUrl,
} from "./resource-path";
import { getScanCoordinates } from "./scan-location";

/**
 * Supported deep link patterns:
 *
 *   shelf://assets/{id}         → Asset detail
 *   shelf://kits/{id}           → Kit detail
 *   shelf://bookings/{id}       → Booking detail
 *   shelf://qr/{qrId}           → QR code resolve → asset or kit detail
 *   shelf://audits/{id}         → Audit detail
 *   shelf://scanner             → Open scanner
 *
 * Also handles HTTPS universal links (iOS) / App Links (Android), which the OS
 * delivers through the same `Linking` APIs once the native association is in
 * place (see apps/companion/app.json + the server `/.well-known/*` routes):
 *
 *   https://app.shelf.nu/qr/{id}
 *   https://app.shelf.nu/assets/{id}
 *   https://app.shelf.nu/bookings/{id}
 *   https://app.shelf.nu/audits/{id}
 *
 * The host above is illustrative, not exhaustive: the app can be connected to a
 * self-hosted Shelf instance, and the parsing here is host-agnostic (it matches
 * on path segments). Which hosts the OS actually delivers is decided by the
 * native association, not by this file.
 *
 * The claimed paths are kept in sync with the iOS AASA `components` list and
 * the Android `intentFilters` path prefixes. Paths outside the claimed prefixes
 * are never delivered to the app and keep opening the web.
 *
 * Division of labour with `app/+native-intent.ts` (`lib/link-routing.ts`):
 * this hook opens every link that names a screen of the app, `https://` and
 * `shelf://`, at launch and while the app runs, on both platforms, through
 * `openLinkedRoute` so the target tab has its list under the screen. The
 * router opens none of them (`systemPathFor`). A claimed path that nests
 * deeper than the app renders (`/assets/:id/overview`) opens the resource
 * detail (`nativeRouteForLink`), and `/qr/:id` resolves through the API first.
 */

/** A link the OS delivered, read into the screen it names. */
export type ParsedLink =
  | { type: "asset"; id: string }
  | { type: "kit"; id: string }
  | { type: "booking"; id: string }
  | { type: "audit"; id: string }
  | {
      type: "qr";
      id: string;
      /**
       * Origin the link came from, set only for http(s) links. A QR id is only
       * meaningful on the instance that minted it, so a link from another
       * origin must not be resolved against the active server. A custom-scheme
       * link names no server, so it is left undefined and resolved here.
       */
      origin?: string;
    }
  | { type: "scanner" }
  | { type: "unknown" };

/**
 * Reads a link the OS delivered into the screen it names.
 *
 * Matching goes through {@link matchResourcePath}, the same allowlist
 * `nativeRouteForLink` uses, and an id that is not a plain record id names
 * nothing. The hook reads the kind to find QR links and their origin; the
 * route it opens comes from `nativeRouteForLink` (`linkAction`).
 *
 * @param url - The raw URL (custom scheme or http(s))
 * @returns The parsed link, or `unknown` when it names no screen
 */
export function parseDeepLink(url: string): ParsedLink {
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path ?? "";
    // Custom app scheme (shelf://kits/abc) vs https universal link
    // (https://app.shelf.nu/kits/abc): for the custom scheme expo-linking puts
    // the first segment in `hostname` ("kits") and the rest in `path` ("abc"),
    // whereas for https the hostname is the domain and the resource lives in the
    // path. Normalise both to one segment list so native scheme links resolve.
    const isHttp = parsed.scheme === "http" || parsed.scheme === "https";
    const segments = (
      isHttp ? path.split("/") : [parsed.hostname ?? "", ...path.split("/")]
    ).filter(Boolean);

    // A path that nests deeper than `resource/id` (e.g. /assets/:id/overview,
    // the canonical web asset URL) resolves to the resource detail, which is
    // what the tapper wants.
    const match = matchResourcePath(segments);
    if (!match) return { type: "unknown" };
    // Same rule as `nativeRouteForLink`: an id-named query value that is not
    // a plain record id makes the whole link name nothing.
    if (!queryIdsArePlain(splitLinkUrl(url).query)) return { type: "unknown" };
    const { resource, id } = match;

    if (resource === "scanner") return { type: "scanner" };
    if (!id) return { type: "unknown" };

    switch (resource) {
      case "assets":
        return { type: "asset", id };
      case "kits":
        return { type: "kit", id };
      case "bookings":
        return { type: "booking", id };
      case "audits":
        return { type: "audit", id };
      case "qr": {
        // Only an http(s) link names a server. `new URL()` reports the string
        // "null" as the origin of a custom-scheme URL, and carrying that
        // forward would mark the app's own `shelf://qr/<id>` links foreign and
        // send them to "null/qr/<id>".
        const parsedUrl = new URL(url);
        const origin =
          parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
            ? parsedUrl.origin
            : undefined;
        return { type: "qr", id, origin };
      }
    }
  } catch {
    return { type: "unknown" };
  }
}

/**
 * The real lookups behind {@link resolveQrOutcome}: `scan` records the scan
 * with its best-effort coordinates (read-only: `getScanCoordinates` never
 * prompts, returns within about 1.5s, and null records the scan without a
 * position); `lookup` records nothing.
 */
const QR_LOOKUPS: QrLookups = {
  scan: async (qrId) => api.qr(qrId, undefined, await getScanCoordinates()),
  lookup: (qrId, orgId) => api.getScannedItem(qrId, orgId),
};

/**
 * Resolves a QR code link the OS delivered and opens its asset or kit.
 *
 * An https link from the connected server records a scan, exactly as opening
 * the same address on the web does (a label scanned with the system camera
 * arrives this way). A `shelf://qr/<id>` link records nothing: no label
 * encodes the custom scheme, so only another app or a web page can open it.
 * See `qrLinkRecordsScan` in `./link-dispatch.ts`.
 *
 * A code that does not resolve in the app (another workspace, unclaimed,
 * not authorized, or a failed lookup), or one from another Shelf server,
 * opens the web QR page, which renders the right flow (claim, link,
 * contact-owner, sign-in). It opens in the in-app browser via
 * {@link openShelfWebUrl}, never `Linking.openURL`: `/qr/*` is a verified
 * App Link, and `Linking.openURL` would re-enter the app and loop back here.
 *
 * @param qrId - The linked QR code id.
 * @param origin - The origin the link carried, when it had one.
 */
export async function resolveQrAndNavigate(qrId: string, origin?: string) {
  const accountAtStart = accountGeneration.current();
  const outcome = await resolveQrOutcome(
    qrId,
    origin,
    getApiBaseUrl(),
    { source: "os-link" },
    QR_LOOKUPS
  );
  // A sign-out, another account or a server switch during the lookup ends
  // the session the link was resolved for: open nothing over the login screen.
  if (accountGeneration.current() !== accountAtStart) return;
  if (outcome.kind === "screen") {
    pushIntoTab(outcome.tabRoot, outcome.href ?? undefined);
    return;
  }
  void openShelfWebUrl(outcome.url);
}

/**
 * Looks up a QR link tapped in text someone wrote. It records nothing (no
 * scan, location or note), and a code that does not resolve gets the
 * web-only notice instead of the web login.
 *
 * @param qrId - The linked QR code id.
 * @param origin - The origin of the link.
 * @param orgId - The workspace on show, which the lookup needs for a SAM id.
 * @returns Where the code leads.
 */
export function resolveTappedQr(
  qrId: string,
  origin: string,
  orgId?: string
): Promise<QrOutcome> {
  return resolveQrOutcome(
    qrId,
    origin,
    getApiBaseUrl(),
    { source: "tapped", orgId },
    QR_LOOKUPS
  );
}

/**
 * Handles incoming deep links and navigates to the appropriate screen.
 * Call this hook inside your authenticated layout so navigation is available.
 */
export function useDeepLinkHandler() {
  useEffect(() => {
    // The launch link opens after a short delay. A different link arriving
    // first, or the hook unmounting, cancels it so it cannot cover the newer
    // screen. The same URL arriving again as a `url` event does not cancel
    // it: that is the launch link delivered twice, not a newer one.
    let disposed = false;
    let launchUrl: string | undefined;
    let launchTimer: ReturnType<typeof setTimeout> | undefined;
    let lastEventUrl: string | undefined;

    /**
     * Stops a scheduled launch-link navigation, if one is pending, and forgets
     * the launch link so the same link tapped later opens normally.
     */
    function cancelLaunchLink() {
      if (launchTimer) clearTimeout(launchTimer);
      launchTimer = undefined;
      launchUrl = undefined;
    }

    /**
     * Opens a link that arrives while the app is running. The launch link
     * delivered again as a `url` event is left to the launch timer.
     *
     * @param event - the `url` event from expo-linking
     */
    function handleUrl(event: { url: string }) {
      lastEventUrl = event.url;
      if (event.url === launchUrl) return;
      cancelLaunchLink();
      openLink(event.url);
    }

    /**
     * Opens the screen a link names (`linkAction`): a route anchored in its
     * tab, so "back" returns to the list, or a QR code resolved through the
     * API first.
     *
     * @param url - the raw URL the OS delivered
     */
    function openLink(url: string) {
      const action = linkAction(url, parseDeepLink(url));
      if (action.kind === "route") {
        openLinkedRoute(action.route);
      } else if (action.kind === "qr") {
        void resolveQrAndNavigate(action.id, action.origin);
      }
    }

    // Open the URL that launched the app (cold start), after a short delay
    // that lets navigation mount. A link that already arrived as a `url`
    // event was opened there: the same URL is the launch link delivered
    // twice, and a different one is newer than it.
    Linking.getInitialURL().then((url) => {
      if (!url || disposed || lastEventUrl) return;
      launchUrl = url;
      launchTimer = setTimeout(() => {
        // Opened: the same link tapped again later is a new tap.
        cancelLaunchLink();
        openLink(url);
      }, 500);
    });

    // Handle URLs received while the app is already open (warm start)
    const subscription = Linking.addEventListener("url", handleUrl);

    return () => {
      disposed = true;
      cancelLaunchLink();
      subscription.remove();
    };
  }, []);
}
