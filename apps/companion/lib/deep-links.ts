import { useEffect } from "react";
import * as Linking from "expo-linking";
import { api } from "./api";
import { openShelfWebUrl, pushIntoTab } from "./navigation";

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
 * The claimed paths are kept in sync with the iOS AASA `components` list and
 * the Android `intentFilters` path prefixes. Paths outside the claimed prefixes
 * are never delivered to the app and keep opening the web. A claimed prefix that
 * nests deeper than the app can render (e.g. `/assets/:id/edit`) is opened in
 * the in-app web view instead of landing on the wrong native screen.
 */

type ParsedLink =
  | { type: "asset"; id: string }
  | { type: "kit"; id: string }
  | { type: "booking"; id: string }
  | { type: "audit"; id: string }
  | { type: "qr"; id: string }
  | { type: "scanner" }
  // A claimed HTTPS prefix matched but the path nests deeper than the native
  // app can render (e.g. /assets/:id/edit) — open the original URL in the web
  // view rather than a wrong native screen.
  | { type: "web"; url: string }
  | { type: "unknown" };

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

    const [resource, id] = segments;

    // Over-claim guard: the OS delivers every nested path under a claimed prefix
    // (e.g. /assets/:id/edit, /bookings/:id/overview/checkin-assets), but the
    // native app only renders the resource detail and the OS path patterns can't
    // be scoped to a single segment. So for an HTTPS link that nests deeper than
    // `resource/id`, open the original URL in the in-app web view (loop-safe via
    // openShelfWebUrl, NOT Linking.openURL which App Links would re-intercept)
    // rather than landing on the wrong native screen.
    const CLAIMED_HTTPS_PREFIXES = ["qr", "assets", "bookings", "audits"];
    if (
      isHttp &&
      id &&
      segments.length > 2 &&
      CLAIMED_HTTPS_PREFIXES.includes(resource)
    ) {
      return { type: "web", url };
    }

    switch (resource) {
      case "assets":
        return id ? { type: "asset", id } : { type: "unknown" };
      case "kits":
        return id ? { type: "kit", id } : { type: "unknown" };
      case "bookings":
        return id ? { type: "booking", id } : { type: "unknown" };
      case "audits":
        return id ? { type: "audit", id } : { type: "unknown" };
      case "qr":
        return id ? { type: "qr", id } : { type: "unknown" };
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
 * Resolves a QR code ID in-app and navigates to the matching screen: an asset
 * detail when the QR maps to an asset, or a kit detail when it maps to a kit
 * (kits live in the Assets stack).
 *
 * When the QR can't be resolved in-app (it belongs to another org, is unclaimed,
 * the user isn't authorized, or the lookup errors) we hand off to the web QR
 * resolver, which renders the correct flow (claim, link, contact-owner, login).
 * The hand-off uses an in-app browser via {@link openShelfWebUrl} rather than
 * `Linking.openURL`, because `/qr/*` is now a verified Android App Link and
 * `Linking.openURL` would re-enter the app and loop back here.
 *
 * @param qrId - the scanned or linked QR code id
 */
async function resolveQrAndNavigate(qrId: string) {
  try {
    const { data, error } = await api.qr(qrId);
    if (!error && data?.qr?.asset?.id) {
      pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${data.qr.asset.id}`);
      return;
    }
    // Kit-linked QR: open the kit detail (it lives in the Assets stack). Without
    // this, scanning a kit's own QR falls through to the scanner instead of the
    // kit it points at.
    if (!error && data?.qr?.kitId) {
      pushIntoTab("/(tabs)/assets", `/(tabs)/assets/kits/${data.qr.kitId}`);
      return;
    }
  } catch {
    // Fall through to the web resolver below.
  }
  // QR resolved to neither an asset nor a kit (other org, unclaimed, error):
  // hand off to the web resolver. Loop-safe in-app browser via openShelfWebUrl,
  // NOT Linking.openURL, because /qr/* is a verified App Link and openURL would
  // re-enter the app and loop back here.
  void openShelfWebUrl(`https://app.shelf.nu/qr/${qrId}`);
}

/**
 * Handles incoming deep links and navigates to the appropriate screen.
 * Call this hook inside your authenticated layout so navigation is available.
 */
export function useDeepLinkHandler() {
  useEffect(() => {
    function handleUrl(event: { url: string }) {
      const link = parseDeepLink(event.url);
      navigateToLink(link);
    }

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
          void resolveQrAndNavigate(link.id);
          break;
        case "scanner":
          pushIntoTab("/(tabs)/scanner");
          break;
        case "web":
          // Claimed prefix nested deeper than the app renders: open the real
          // web page in the in-app browser (loop-safe) instead of a wrong
          // native screen.
          void openShelfWebUrl(link.url);
          break;
        case "unknown":
          // Ignore unrecognized links — nothing to navigate to.
          break;
      }
    }

    // Handle the URL that launched the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        const link = parseDeepLink(url);
        // Skip navigation for unrecognized links.
        if (link.type !== "unknown") {
          // Small delay to let navigation mount
          setTimeout(() => navigateToLink(link), 500);
        }
      }
    });

    // Handle URLs received while the app is already open (warm start)
    const subscription = Linking.addEventListener("url", handleUrl);

    return () => subscription.remove();
  }, []);
}
