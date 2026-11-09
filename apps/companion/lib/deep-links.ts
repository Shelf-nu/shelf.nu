import { useEffect } from "react";
import * as Linking from "expo-linking";
import { api, getApiBaseUrl } from "./api";
import { openShelfWebUrl, pushIntoTab } from "./navigation";
import { matchResourcePath } from "./resource-path";
import { isSameOrigin } from "./server/contract";

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
 * Division of labour with `app/+native-intent.ts`: HTTPS universal links are
 * rewritten there to native routes and handled by expo-router itself (a
 * claimed path that nests deeper than the app renders, e.g.
 * `/assets/:id/overview`, maps to the resource detail). This hook only
 * handles (a) custom-scheme links, which have no native path mapping
 * guarantees, and (b) `/qr/:id` links, which need an async API resolve.
 * Acting on other HTTPS links here would double-navigate.
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
 * Matching goes through {@link matchResourcePath}, the same allowlist the
 * `+native-intent` rewrite uses, so a warm start and a cold start agree on
 * every link, and an id that is not a plain record id names nothing.
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
 * Resolves a QR code link the OS delivered and opens the matching screen: an
 * asset detail when the QR maps to an asset, or a kit detail when it maps to
 * a kit (kits live in the Assets stack).
 *
 * An OS-delivered link is not proof of a camera scan: any app or web page can
 * open `shelf://qr/<id>`, and a shared https link looks the same as a label
 * scan. The code is therefore resolved WITHOUT recording (no scan, no
 * position, no note), and the person acts on the screen it opens. Scans are
 * recorded only by the in-app scanner.
 *
 * When the QR can't be resolved in-app (it belongs to another org, is
 * unclaimed, the user isn't authorized, or the lookup errors) we hand off to
 * the web QR resolver, which renders the correct flow (claim, link,
 * contact-owner, login). The hand-off uses an in-app browser via
 * {@link openShelfWebUrl} rather than `Linking.openURL`, because `/qr/*` is a
 * verified Android App Link and `Linking.openURL` would re-enter the app and
 * loop back here.
 *
 * A link from another origin is handed straight to the web without a lookup:
 * the id belongs to the instance that minted it, so resolving it against the
 * active server would report "not found" for a code that is valid where it
 * came from.
 *
 * @param qrId - The linked QR code id
 * @param origin - The origin the link carried, when it had one
 */
export async function resolveQrAndNavigate(qrId: string, origin?: string) {
  if (origin && !isSameOrigin(origin, getApiBaseUrl())) {
    void openShelfWebUrl(`${origin}/qr/${encodeURIComponent(qrId)}`);
    return;
  }

  try {
    const { data, error } = await api.getScannedItem(qrId);
    if (!error && data?.qr?.asset?.id) {
      pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${data.qr.asset.id}`);
      return;
    }
    // A kit's own QR opens the kit detail, in the Assets stack.
    if (!error && data?.qr?.kitId) {
      pushIntoTab("/(tabs)/assets", `/(tabs)/assets/kits/${data.qr.kitId}`);
      return;
    }
  } catch {
    // Fall through to the web resolver below.
  }
  void openShelfWebUrl(`${getApiBaseUrl()}/qr/${encodeURIComponent(qrId)}`);
}

/**
 * Handles incoming deep links and navigates to the appropriate screen.
 * Call this hook inside your authenticated layout so navigation is available.
 */
export function useDeepLinkHandler() {
  useEffect(() => {
    /**
     * True for URLs that expo-router already routes natively via the
     * `app/+native-intent.ts` rewrite. Acting on those here too would
     * double-navigate; the exception is `/qr/:id`, which needs an async API
     * resolve that a path rewrite cannot express.
     */
    function isNativelyRouted(url: string, link: ParsedLink) {
      return /^https?:/i.test(url) && link.type !== "qr";
    }

    function handleUrl(event: { url: string }) {
      const link = parseDeepLink(event.url);
      if (isNativelyRouted(event.url, link)) return;
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

    // Handle the URL that launched the app (cold start). HTTPS links are
    // already routed by expo-router via the +native-intent rewrite — only
    // custom-scheme links and /qr resolution need JS navigation here.
    Linking.getInitialURL().then((url) => {
      if (url) {
        const link = parseDeepLink(url);
        // Skip natively-routed and unrecognized links.
        if (link.type !== "unknown" && !isNativelyRouted(url, link)) {
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
