/**
 * Apple App Site Association (AASA) file for iOS Universal Links
 *
 * This file tells iOS which URLs should open in the Shelf Companion app
 * instead of Safari. Apple fetches this file when the app is installed
 * to verify the domain-app association.
 *
 * @see https://developer.apple.com/documentation/xcode/supporting-associated-domains
 * @see {@link file://./../../../../companion/lib/deep-links.ts} - Deep link handler
 */

import { data, type LoaderFunctionArgs } from "react-router";

/** Apple Team ID from Apple Developer Portal */
const APPLE_TEAM_ID = "27Q4MHFB8K";

/** iOS Bundle Identifier from app.json */
const IOS_BUNDLE_ID = "com.shelf.companion";

/**
 * GET /.well-known/apple-app-site-association
 *
 * Returns the AASA file that iOS uses to verify Universal Links.
 * Must be served over HTTPS with content-type application/json.
 */
export async function loader(_args: LoaderFunctionArgs) {
  const aasa = {
    applinks: {
      apps: [], // Required to be empty array
      details: [
        {
          appID: `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`,
          paths: [
            // QR code resolution - opens scanner or shows QR details
            "/qr/*",
            // Asset details - opens asset in app
            "/assets/*",
            // Booking details - opens booking in app
            "/bookings/*",
          ],
        },
      ],
    },
    // webcredentials allows the app to be associated with saved passwords
    webcredentials: {
      apps: [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`],
    },
  };

  return data(aasa, {
    headers: {
      "Content-Type": "application/json",
      // Cache for 1 hour - Apple caches this aggressively anyway
      "Cache-Control": "public, max-age=3600",
    },
  });
}
