import { useEffect } from "react";

const BEACON_SCRIPT_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/**
 * Cloudflare Web Analytics
 *
 * Injects the Cloudflare Web Analytics beacon script on the client
 * when the `CLOUDFLARE_WEB_ANALYTICS_TOKEN` environment variable is set.
 * Uses useEffect to avoid server/client hydration mismatches — the
 * component always renders nothing, and the script is appended to the
 * document head on mount.
 *
 * @see https://developers.cloudflare.com/analytics/web-analytics/
 */
export function CloudflareWebAnalytics() {
  useEffect(() => {
    const token = window.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
    if (!token) return;

    const script = document.createElement("script");
    script.defer = true;
    script.src = BEACON_SCRIPT_SRC;
    script.dataset.cfBeacon = JSON.stringify({ token });
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return null;
}
