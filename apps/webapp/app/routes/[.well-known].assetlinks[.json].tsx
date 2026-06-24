/**
 * Android Asset Links (Digital Asset Links)
 *
 * Served at `https://app.shelf.nu/.well-known/assetlinks.json` so Android can
 * verify the Shelf Companion app's claim over this domain and route matching
 * `https://` links into the native app (verified App Links) instead of Chrome.
 *
 * Unlike iOS, Android does NOT do path-level scoping here — `assetlinks.json`
 * only declares the domain↔app association. The path allowlist
 * (`/qr`, `/assets`, `/bookings`, `/audits`) lives in the app's
 * `<intent-filter>` declarations (`apps/companion/app.json` → `android.intentFilters`).
 *
 * The SHA-256 signing-certificate fingerprints are read from
 * `ANDROID_CERT_FINGERPRINTS` (comma-separated, supports multiple keys — e.g.
 * the Google Play App Signing key plus an EAS internal-build key). These MUST
 * be the **Play App Signing** fingerprints (the key Google holds), not the
 * upload key — the #1 cause of silent App Links verification failure. When the
 * env var is unset the route 404s, so an unconfigured environment fails safe.
 *
 * @see apps/companion/lib/deep-links.ts — the in-app handler that routes the
 *   delivered URLs to the correct screen.
 * @see apps/companion/app.json — `android.intentFilters` (the app-side claim).
 * @see https://developer.android.com/training/app-links/verify-android-applinks
 */

/** The Companion app's Android package name (constant; see app.json). */
const ANDROID_PACKAGE_NAME = "com.shelf.companion";

/**
 * Resource route loader. Returns the Digital Asset Links JSON with an explicit
 * `application/json` content type, or 404 when no signing fingerprints are
 * configured.
 *
 * @returns A JSON `Response` describing the App Links association, or a 404
 *   `Response` when `ANDROID_CERT_FINGERPRINTS` is unset/empty.
 */
export function loader() {
  const fingerprints = (process.env.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((fp) => fp.trim())
    .filter(Boolean);

  if (fingerprints.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
