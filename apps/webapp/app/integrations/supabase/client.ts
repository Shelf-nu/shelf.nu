/**
 * Supabase clients
 *
 * `supabaseClient` uses the public anon key and is safe in the browser.
 * `getSupabaseAdmin` uses the server's admin credential and must never reach
 * the browser.
 *
 * @see {@link file://./../../utils/env.ts} for SUPABASE_SECRET_KEY and the
 *   deprecated SUPABASE_SERVICE_ROLE
 * @see {@link file://./../../utils/client-ip.server.ts} for where the visitor IP
 *   comes from
 */
import { createClient } from "@supabase/supabase-js";

import {
  SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE,
  SUPABASE_URL,
  SUPABASE_ANON_PUBLIC,
} from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { isBrowser } from "~/utils/is-browser";

/**
 * Builds a Supabase client that never stores or refreshes a session itself.
 *
 * @param supabaseKey - The API key the client authenticates with
 * @param headers - Extra headers sent on every request
 */
function getSupabaseClient(
  supabaseKey: string,
  headers: Record<string, string> = {}
) {
  return createClient(SUPABASE_URL, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { headers },
  });
}

const supabaseClient = getSupabaseClient(SUPABASE_ANON_PUBLIC);

/** Options for {@link getSupabaseAdmin}. */
type SupabaseAdminOptions = {
  /**
   * The IP of the visitor whose action this call performs (from
   * `getClientIpFromHeaders`). Pass it on every sign-in, sign-up, code and
   * reset call so Supabase Auth's per-IP limits count the visitor, not this
   * server.
   */
  clientIp?: string | null;
};

/**
 * Provides a Supabase Admin Client with full admin privileges.
 *
 * It's a per request scoped client, to prevent access token leaking if you don't use it like `getSupabaseAdmin().auth.api`.
 * Reason : https://github.com/rphlmr/supa-fly-stack/pull/43#issue-1336412790
 *
 * Authenticates with `SUPABASE_SECRET_KEY` when set, else the legacy
 * `SUPABASE_SERVICE_ROLE`. With a secret key and a `clientIp`, it sends
 * `Sb-Forwarded-For`, which Supabase Auth uses as the caller's IP when the
 * project has IP address forwarding enabled. Supabase ignores the header for
 * legacy keys, so it is only sent with a secret key.
 *
 * @param options - See {@link SupabaseAdminOptions}
 * @throws {ShelfError} When called in the browser
 */
function getSupabaseAdmin({ clientIp }: SupabaseAdminOptions = {}) {
  if (isBrowser)
    throw new ShelfError({
      cause: null,
      message:
        "getSupabaseAdmin is not available in browser and should NOT be used in insecure environments",
      label: "Dev error",
    });

  if (SUPABASE_SECRET_KEY) {
    return getSupabaseClient(
      SUPABASE_SECRET_KEY,
      clientIp ? { "Sb-Forwarded-For": clientIp } : {}
    );
  }

  return getSupabaseClient(SUPABASE_SERVICE_ROLE);
}

export { getSupabaseAdmin, supabaseClient };
