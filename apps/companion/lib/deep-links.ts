import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { api } from "./api";
import { pushIntoTab } from "./navigation";

/**
 * Supported deep link patterns:
 *
 *   shelf://assets/{id}         → Asset detail
 *   shelf://bookings/{id}       → Booking detail
 *   shelf://qr/{qrId}           → QR code resolve → asset detail
 *   shelf://scanner             → Open scanner
 *   shelf://reset-password      → Handled by Supabase auth (no-op in app)
 *
 * Also handles HTTPS universal links:
 *   https://app.shelf.nu/qr/{id}
 *   https://app.shelf.nu/assets/{id}
 */

type ParsedLink =
  | { type: "asset"; id: string }
  | { type: "booking"; id: string }
  | { type: "qr"; id: string }
  | { type: "scanner" }
  | { type: "unknown" };

function parseDeepLink(url: string): ParsedLink {
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path ?? "";
    const segments = path.split("/").filter(Boolean);

    if (segments.length === 0) return { type: "unknown" };

    const [resource, id] = segments;

    switch (resource) {
      case "assets":
        return id ? { type: "asset", id } : { type: "unknown" };
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
 * Resolves a QR code ID to an asset and navigates to it.
 * Falls back to scanner tab if the QR doesn't map to an asset.
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
  } catch {
    // Fall through to scanner
  }
  // If QR doesn't resolve to an asset, open the scanner
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
          // Ignore unrecognized links (e.g., reset-password handled by Supabase)
          break;
      }
    }

    // Handle the URL that launched the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        const link = parseDeepLink(url);
        // Don't navigate for reset-password — Supabase handles it
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
