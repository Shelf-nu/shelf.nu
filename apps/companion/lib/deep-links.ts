import { useEffect } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { api, getApiBaseUrl } from "./api";
import { isOpenedByRouter, launchAction } from "./link-routing";
import { openLinkedRoute, openShelfWebUrl, pushIntoTab } from "./navigation";
import {
  resolveQrOutcome,
  type QrLookups,
  type QrOutcome,
} from "./link-dispatch";
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
 * Division of labour with `app/+native-intent.ts`, decided per link by
 * `isOpenedByRouter` (`lib/link-routing.ts`). HTTPS universal links are
 * rewritten there to native routes (a claimed path that nests deeper than the
 * app renders, e.g. `/assets/:id/overview`, maps to the resource detail).
 *
 * - While the app runs, expo-router opens every HTTPS link except `/qr/:id`.
 *   This hook opens custom-scheme links and resolves `/qr/:id` through the API.
 * - At launch, the same split applies on Android. On iOS the router does not
 *   open the launch URL, so this hook opens HTTPS launch links too, through
 *   the router's own mapping (`webLaunchRoute`), which keeps nested kit ids
 *   and the query.
 *
 * Opening a link the router already opens would navigate twice.
 */

type ParsedLink =
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
 * Reads the link kind and id out of a custom-scheme or HTTPS link. Matches on
 * path segments only, so it works for any Shelf host.
 *
 * @param url - the raw URL the OS delivered
 * @returns the parsed link, or `{ type: "unknown" }` when it names nothing
 *   the app opens
 */
function parseDeepLink(url: string): ParsedLink {
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

    if (segments.length === 0) return { type: "unknown" };

    // A path that nests deeper than `resource/id` (e.g. /assets/:id/overview,
    // the canonical web asset URL) resolves to the resource detail — that is
    // what the tapper wants, and it matches the +native-intent rewrite so warm
    // and cold starts behave identically.
    const [resource, id] = segments;

    switch (resource) {
      case "assets":
        return id ? { type: "asset", id } : { type: "unknown" };
      case "kits":
        return id ? { type: "kit", id } : { type: "unknown" };
      case "bookings":
        return id ? { type: "booking", id } : { type: "unknown" };
      case "audits":
        return id ? { type: "audit", id } : { type: "unknown" };
      case "qr": {
        if (!id) return { type: "unknown" };
        // Only an http(s) link names a server. `new URL()` reports the string
        // "null" as the origin of a custom-scheme URL, and carrying that
        // forward would mark the app's own `shelf://qr/<id>` links foreign and
        // send them to "null/qr/<id>".
        const parsed = new URL(url);
        const origin =
          parsed.protocol === "http:" || parsed.protocol === "https:"
            ? parsed.origin
            : undefined;
        return { type: "qr", id, origin };
      }
      case "scanner":
      case "scan":
        return { type: "scanner" };
      default:
        return { type: "unknown" };
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
 * Resolves a QR code the OS delivered (a camera scan of a label) and opens
 * its asset or kit, recording the scan like the in-app scanner does.
 *
 * A code that does not resolve in the app (another workspace, unclaimed,
 * not authorized, or a failed lookup), or one from another Shelf server,
 * opens the web QR page, which renders the right flow (claim, link,
 * contact-owner, sign-in). It opens in the in-app browser via
 * {@link openShelfWebUrl}, never `Linking.openURL`: `/qr/*` is a verified
 * App Link, and `Linking.openURL` would re-enter the app and loop back here.
 *
 * @param qrId - The scanned QR code id.
 * @param origin - The origin the link carried, when it had one.
 */
export async function resolveQrAndNavigate(qrId: string, origin?: string) {
  const outcome = await resolveQrOutcome(
    qrId,
    origin,
    getApiBaseUrl(),
    { recordScan: true },
    QR_LOOKUPS
  );
  if (outcome.kind === "screen") {
    pushIntoTab(outcome.tabRoot, outcome.href ?? undefined);
    return;
  }
  void openShelfWebUrl(outcome.url);
}

/**
 * Looks up a QR link tapped in text someone wrote. It is not a scan, so it
 * records nothing (no scan, location or note), and a code that does not
 * resolve gets the web-only notice instead of the web login.
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
    { recordScan: false, orgId },
    QR_LOOKUPS
  );
}

/**
 * Handles incoming deep links and navigates to the appropriate screen.
 * Call this hook inside your authenticated layout so navigation is available.
 */
export function useDeepLinkHandler() {
  useEffect(() => {
    /**
     * Opens a link that arrives while the app is running, unless the router
     * opens it itself.
     *
     * @param event - the `url` event from expo-linking
     */
    function handleUrl(event: { url: string }) {
      const link = parseDeepLink(event.url);
      if (
        isOpenedByRouter({
          url: event.url,
          linkType: link.type,
          initial: false,
          platform: Platform.OS,
        })
      ) {
        return;
      }
      navigateToLink(link);
    }

    /**
     * Opens the screen a parsed link names, anchored in its tab so "back"
     * returns to the list. QR links resolve through the API first.
     *
     * @param link - the link parsed by `parseDeepLink`
     */
    function navigateToLink(link: ParsedLink) {
      switch (link.type) {
        case "asset":
          pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${link.id}`);
          break;
        case "kit":
          pushIntoTab("/(tabs)/assets", `/(tabs)/assets/kits/${link.id}`);
          break;
        case "booking":
          pushIntoTab("/(tabs)/bookings", `/(tabs)/bookings/${link.id}`);
          break;
        case "audit":
          pushIntoTab("/(tabs)/audits", `/(tabs)/audits/${link.id}`);
          break;
        case "qr":
          // Resolve the QR code to an asset and navigate directly
          void resolveQrAndNavigate(link.id, link.origin);
          break;
        case "scanner":
          pushIntoTab("/(tabs)/scanner");
          break;
        case "unknown":
          // Ignore unrecognized links — nothing to navigate to.
          break;
      }
    }

    // Handle the URL that launched the app (cold start). `launchAction`
    // decides what to open; links the router opens itself come back `none`.
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const link = parseDeepLink(url);
      const action = launchAction({
        url,
        linkType: link.type,
        platform: Platform.OS,
      });
      // The delay lets navigation mount.
      if (action.kind === "route") {
        const { route } = action;
        setTimeout(() => openLinkedRoute(route), 500);
      } else if (action.kind === "link") {
        setTimeout(() => navigateToLink(link), 500);
      }
    });

    // Handle URLs received while the app is already open (warm start)
    const subscription = Linking.addEventListener("url", handleUrl);

    return () => subscription.remove();
  }, []);
}
