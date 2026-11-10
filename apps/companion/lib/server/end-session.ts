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
    getSession: () => Promise<{
      data: { session: unknown };
      error?: unknown;
    }>;
    /**
     * Stops the client's background token refresh. The app restarts it on the
     * next sign-in (`lib/auth-context.tsx`).
     */
    stopAutoRefresh?: () => Promise<void>;
  };
};

/**
 * How many times a forced teardown re-checks that the stored session stayed
 * gone. One re-check covers a token refresh that was already running when the
 * session was deleted; the second is a margin.
 */
const FORCED_TEARDOWN_CHECKS = 2;

/** The longest one session check may take before it counts as inconclusive. */
export const SESSION_CHECK_TIMEOUT_MS = 5_000;

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
  client: SessionEndingClient,
  timeoutMs: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A stored session past its expiry makes `getSession` try a refresh, which
  // can hang while offline: past the cap the check counts as inconclusive.
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([client.auth.getSession(), timedOut]);
    if (result === "timeout") return true;
    // An error (a failed refresh) can come with a null session while the
    // credentials stay on disk, so it proves nothing: inconclusive.
    if (result.error) return true;
    return Boolean(result.data.session);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/** How far the teardown had to go. */
export type SessionEndOutcome =
  /** The server revoked the session and supabase-js removed it. */
  | "revoked"
  /** The revoke failed; supabase-js removed the session locally. */
  | "local"
  /** Both sign-outs failed; the stored session was deleted directly. */
  | "forced"
  /**
   * Both sign-outs failed and the stored session was still there after every
   * delete. The in-memory state is cleared regardless; the caller reports it.
   */
  | "incomplete";

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
 * @param removePersistedSession - Deletes the stored session for that client
 *   and verifies it; a throw counts as a failed, unverified delete
 * @param options - `stillCurrent` and `blockStoredSession` (see their docs)
 *   and `checkTimeoutMs`, the cap
 *   on each session check (tests shorten it)
 * @returns How far the teardown went. Never rejects.
 */
export async function endSessionOnDevice(
  client: SessionEndingClient,
  removePersistedSession: () => Promise<void>,
  {
    stillCurrent = () => true,
    checkTimeoutMs = SESSION_CHECK_TIMEOUT_MS,
    blockStoredSession = async () => {},
  }: {
    /**
     * False when another session replaced this one while the teardown ran (a
     * server switch): the after-session-end tasks are then skipped, so they
     * cannot reset the replacement account's state.
     */
    stillCurrent?: () => boolean;
    checkTimeoutMs?: number;
    /**
     * Refuses the stored session from now on. Called on an "incomplete"
     * outcome, before the after-session-end tasks, so nothing that runs
     * between can read and cache the old session's token.
     */
    blockStoredSession?: () => Promise<void>;
  } = {}
): Promise<SessionEndOutcome> {
  let outcome: SessionEndOutcome = "revoked";
  if (!(await trySignOut(client, "global"))) {
    outcome = "local";
    if (!(await trySignOut(client, "local"))) {
      outcome = "forced";
      // No new background refresh may start from here on, so none can read
      // the session before it is deleted and write it back afterwards.
      try {
        await client.auth.stopAutoRefresh?.();
      } catch {
        // Best-effort; the re-checks below still catch a write-back.
      }
      // The deletion happens outside supabase-js's auth lock, so a token
      // refresh that was already running can write the session back. Delete,
      // then check under the lock, and delete again if it came back.
      let stored = true;
      for (let check = 0; check <= FORCED_TEARDOWN_CHECKS && stored; check++) {
        let removed = true;
        try {
          await removePersistedSession();
        } catch {
          // An unverifiable delete proves nothing: the session counts as
          // still stored whatever a session read says (the storage adapter
          // reads a failing store as "nothing stored").
          removed = false;
        }
        const checkedStored = await sessionStillStored(client, checkTimeoutMs);
        stored = !removed || checkedStored;
      }
      if (stored) {
        outcome = "incomplete";
        try {
          await blockStoredSession();
        } catch {
          // Reported by the caller through the "incomplete" outcome.
        }
      }
    }
  }
  if (stillCurrent()) runAfterSessionEnd();
  return outcome;
}

/**
 * Whether a finished sign-out may clear the app's signed-in state. A forced
 * sign-out emits no auth event, so the app clears the state itself, but never
 * over a session that started while the teardown ran.
 *
 * @param start - Sign-in count and server version when the sign-out began
 * @param now - The same values now
 * @returns True when nobody signed in and the server did not change
 */
export function signOutMayClearState(
  start: { signIns: number; serverVersion: number },
  now: { signIns: number; serverVersion: number }
): boolean {
  return (
    start.signIns === now.signIns && start.serverVersion === now.serverVersion
  );
}
