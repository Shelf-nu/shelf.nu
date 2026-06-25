import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { api } from "./api";
import { pushIntoTab } from "./navigation";

/**
 * Supported deep link patterns:
 *
 *   shelf://assets/{id}         → Asset detail
 *   shelf://kits/{id}           → Kit detail
 *   shelf://bookings/{id}       → Booking detail
 *   shelf://qr/{qrId}           → QR code resolve → asset or kit detail
 *   shelf://scanner             → Open scanner
 *
 * Also handles HTTPS universal links:
 *   https://app.shelf.nu/qr/{id}
 *   https://app.shelf.nu/assets/{id}
 */

type ParsedLink =
  | { type: "asset"; id: string }
  | { type: "kit"; id: string }
  | { type: "booking"; id: string }
  | { type: "qr"; id: string }
  | { type: "scanner" }
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

    switch (resource) {
      case "assets":
        return id ? { type: "asset", id } : { type: "unknown" };
      case "kits":
        return id ? { type: "kit", id } : { type: "unknown" };
      case "bookings":
        return id ? { type: "booking", id } : { type: "unknown" };
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
 * Resolves a QR code ID to its linked asset or kit and navigates to it.
 * Falls back to the scanner tab if the QR maps to neither.
 */
async function resolveQrAndNavigate(
  qrId: string,
  router: ReturnType<typeof useRouter>
) {
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
    // Fall through to scanner
  }
  // If the QR resolves to neither an asset nor a kit, open the scanner
  router.push("/(tabs)/scanner");
}

/**
 * Handles incoming deep links and navigates to the appropriate screen.
 * Call this hook inside your authenticated layout so navigation is available.
 */
export function useDeepLinkHandler() {
  const router = useRouter();

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
        case "qr":
          // Resolve the QR code to an asset and navigate directly
          resolveQrAndNavigate(link.id, router);
          break;
        case "scanner":
          router.push("/(tabs)/scanner");
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
  }, [router]);
}
