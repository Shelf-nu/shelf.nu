/**
 * Instance self-description for the companion app.
 *
 * Every Shelf instance serves this. After the registry tells the companion app
 * which server a user belongs to, the app fetches this endpoint from that
 * server and uses the returned Supabase credentials to rebuild its auth client
 * against it.
 *
 * Keeping the Supabase config HERE rather than in Shelf Cloud's registry is
 * deliberate: an instance that rotates its Supabase project stays connectable
 * with no change on Shelf's side, and Shelf never has to hold every customer's
 * credentials.
 *
 * Unauthenticated by necessity — the caller has no session yet. Nothing here is
 * secret: the anon key is public by design and already ships in the web client.
 * Because it IS public on every instance, do not widen this payload without
 * re-reading that sentence; the route test pins the exact key set.
 *
 * @see {@link file://./resolve-server.ts} — how the app learns which server
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { config } from "~/config/shelf.config";
import {
  INSTANCE_NAME,
  MIN_COMPANION_VERSION,
  SUPABASE_ANON_PUBLIC,
  SUPABASE_URL,
} from "~/utils/env";

/**
 * Wire-contract version of the mobile API surface.
 *
 * Bump ONLY on a breaking change to `/api/mobile/*`. The companion app carries
 * a matching floor (`MIN_SERVER_MOBILE_API_VERSION`) and refuses to connect to
 * a server below it, so this number is what lets an old self-hosted instance
 * fail with a clear message instead of a pile of 404s.
 */
export const MOBILE_API_VERSION = 1;

/**
 * GET /api/mobile/config
 *
 * @param _args - React Router loader args. Unused: the response describes the
 *   instance, not the request.
 * @returns JSON describing this instance to the companion app.
 */
export function loader(_args: LoaderFunctionArgs) {
  return data({
    name: INSTANCE_NAME || "Shelf",
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_PUBLIC,
    mobileApiVersion: MOBILE_API_VERSION,
    // Lowest app version this instance accepts, or null for "any". The app
    // shows a blocking update prompt when it is older than this. `mobileApiVersion`
    // guards the other direction (server too old for the app); the two are
    // independent because neither side can update the other.
    minCompanionVersion: MIN_COMPANION_VERSION || null,
    ssoEnabled: !config.disableSSO,
    // Password login is an organisation-level concern (SSO orgs disable it per
    // organisation), not an instance-level one, so this is always true today.
    // It exists so the app can hide the password fields when that changes.
    passwordLoginEnabled: true,
  });
}
