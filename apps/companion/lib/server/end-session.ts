/**
 * Ends a session on this device, whatever the server says.
 *
 * Both paths that end a session use {@link endSessionOnDevice}: the app's own
 * sign-out (`lib/auth-context.tsx`) and the sign-out a server switch performs
 * (`./active-server.ts`). supabase-js returns, rather than throws, a failed
 * revoke, and for any failure other than a 401/403/404 it keeps the stored
 * session; with an expired access token and no network even a local sign-out
 * returns an error before removing anything. Signing out must still leave no
 * session on the phone, so the teardown escalates until the stored session is
 * gone, then runs the after-session-end tasks (`./session-end.ts`) that drop
 * in-memory state tied to the account.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./end-session.test.ts}
 */
import { runAfterSessionEnd } from "./session-end";

/** The slice of a Supabase client this module needs. */
export type SessionEndingClient = {
  auth: {
    signOut: (options?: {
      scope?: "global" | "local" | "others";
    }) => Promise<{ error: unknown }>;
    getSession: () => Promise<{ data: { session: unknown } }>;
  };
};

/**
 * How many times a forced teardown re-checks that the stored session stayed
 * gone. One re-check covers a token refresh that was already running when the
 * session was deleted; the second is a margin.
 */
const FORCED_TEARDOWN_CHECKS = 2;

/**
 * Whether the client still finds a stored session.
 *
 * `getSession` waits for supabase-js's auth lock, so it returns only after any
 * token refresh that was in flight has finished (and possibly written the
 * session back).
 *
 * @param client - The live Supabase client
 * @returns True when a session is still stored, or when the check failed
 */
async function sessionStillStored(
  client: SessionEndingClient
): Promise<boolean> {
  try {
    const { data } = await client.auth.getSession();
    return Boolean(data.session);
  } catch {
    return true;
  }
}

/** How far the teardown had to go. */
export type SessionEndOutcome =
  /** The server revoked the session and supabase-js removed it. */
  | "revoked"
  /** The revoke failed; supabase-js removed the session locally. */
  | "local"
  /** Both sign-outs failed; the stored session was deleted directly. */
  | "forced";

/**
 * Calls one sign-out and reports whether it succeeded.
 *
 * @param client - The live Supabase client
 * @param scope - `global` revokes on the server, `local` only on the device
 * @returns True when supabase-js reported no error
 */
async function trySignOut(
  client: SessionEndingClient,
  scope: "global" | "local"
): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut({ scope });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Ends the current session on this device.
 *
 * Tries a server revoke first, then a local sign-out, then deletes the stored
 * session itself. The caller still owns UI state (setting the signed-in user
 * to null), because a forced teardown emits no auth event.
 *
 * @param client - The live Supabase client
 * @param removePersistedSession - Deletes the stored session for that client;
 *   must not throw
 * @returns How far the teardown went. Never rejects.
 */
export async function endSessionOnDevice(
  client: SessionEndingClient,
  removePersistedSession: () => Promise<void>
): Promise<SessionEndOutcome> {
  let outcome: SessionEndOutcome = "revoked";
  if (!(await trySignOut(client, "global"))) {
    outcome = "local";
    if (!(await trySignOut(client, "local"))) {
      outcome = "forced";
      // The deletion happens outside supabase-js's auth lock, so a token
      // refresh that was already running can write the session back. Delete,
      // then check under the lock, and delete again if it came back.
      for (let check = 0; check <= FORCED_TEARDOWN_CHECKS; check++) {
        try {
          await removePersistedSession();
        } catch {
          // Nothing more can be done; the in-memory teardown below still runs.
        }
        if (
          check === FORCED_TEARDOWN_CHECKS ||
          !(await sessionStillStored(client))
        ) {
          break;
        }
      }
    }
  }
  runAfterSessionEnd();
  return outcome;
}
