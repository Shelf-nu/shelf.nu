/**
 * Digital Asset Links file for Android App Links
 *
 * This file tells Android which URLs should open in the Shelf Companion app
 * instead of Chrome. Google fetches this file when the app is installed
 * to verify the domain-app association.
 *
 * @see https://developer.android.com/training/app-links/verify-android-applinks
 * @see {@link file://./../../../../companion/lib/deep-links.ts} - Deep link handler
 */

import { data, type LoaderFunctionArgs } from "react-router";

/** Android Package Name from app.json */
const ANDROID_PACKAGE_NAME = "com.shelf.companion";

/**
 * SHA-256 certificate fingerprints for Android signing keys.
 * These are obtained from EAS Build credentials or your local keystore.
 *
 * To get the fingerprint from EAS managed credentials:
 *   cd apps/companion && eas credentials -p android
 *   Select "production" profile, then view the keystore details
 *
 * To get from a local keystore:
 *   keytool -list -v -keystore your-keystore.jks -alias your-alias
 *
 * Format: "XX:XX:XX:..." (colon-separated uppercase hex)
 */
const SHA256_CERT_FINGERPRINTS = [
  // Production signing key from EAS Build (cS3Aw8Mvxy)
  "DB:55:17:D9:14:31:DB:06:16:30:0A:73:75:1C:2A:6D:36:6A:06:E4:5C:63:AF:EC:81:BB:61:C9:BB:B4:8A:6B",
];

/**
 * GET /.well-known/assetlinks.json
 *
 * Returns the Digital Asset Links file that Android uses to verify App Links.
 * Must be served over HTTPS with content-type application/json.
 */
export async function loader(_args: LoaderFunctionArgs) {
  const assetlinks = SHA256_CERT_FINGERPRINTS.map((fingerprint) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_PACKAGE_NAME,
      sha256_cert_fingerprints: [fingerprint],
    },
  }));

  return data(assetlinks, {
    headers: {
      "Content-Type": "application/json",
      // Cache for 1 hour
      "Cache-Control": "public, max-age=3600",
    },
  });
}
