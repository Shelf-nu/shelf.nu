/**
 * Apple App Site Association (AASA)
 *
 * Served at `https://app.shelf.nu/.well-known/apple-app-site-association` so iOS
 * can verify the Shelf Companion app's claim over this domain and route matching
 * `https://` links into the native app (Universal Links) instead of Safari.
 *
 * Scoping is intentional and security-relevant: we ONLY claim the paths the
 * Companion app has native screens for. Auth/account paths (`/login`,
 * `/oauth/callback`, `/sso-login`, `/forgot-password`, `/join`, `/otp`, …) are
 * deliberately NOT listed — claiming the whole domain would let iOS hijack
 * those links into the app, which has no screen for them, breaking password
 * resets, SSO, and invites for every user with the app installed.
 *
 * The associated app ID is read from `IOS_APP_ID` (format
 * `<TeamID>.com.shelf.companion`). When it is unset the route 404s, so an
 * unconfigured environment fails safe — links keep opening the web app exactly
 * as they do today — rather than serving a broken/garbage association file that
 * Apple's CDN would then cache.
 *
 * @see apps/companion/lib/deep-links.ts — the in-app handler that routes the
 *   delivered URLs to the correct screen.
 * @see apps/companion/app.json — `ios.associatedDomains` (the app-side claim).
 * @see https://developer.apple.com/documentation/xcode/supporting-associated-domains
 */

/** Paths the Companion app can handle natively. Everything else opens the web. */
const DEEP_LINK_COMPONENTS = [
  { "/": "/qr/*", comment: "QR resolve → asset detail" },
  { "/": "/assets/*", comment: "Asset detail" },
  { "/": "/bookings/*", comment: "Booking detail" },
  { "/": "/audits/*", comment: "Audit detail" },
];

/**
 * Resource route loader. Returns the AASA JSON with an explicit
 * `application/json` content type (the file has no extension, so the type must
 * be set deliberately), or 404 when the iOS app ID is not configured.
 *
 * @returns A JSON `Response` describing the Universal Links association, or a
 *   404 `Response` when `IOS_APP_ID` is unset.
 */
export function loader() {
  const appId = process.env.IOS_APP_ID;

  if (!appId) {
    return new Response("Not Found", { status: 404 });
  }

  const body = {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: DEEP_LINK_COMPONENTS,
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN fetches and caches this; a modest TTL keeps updates from
      // being pinned for too long while avoiding a fetch on every install.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
