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
 * @returns "gone" when no session is stored; "stored" when one is, or when
 *   the check failed (inconclusive); "timeout" when it did not answer in time
 */
async function sessionStillStored(
  client: SessionEndingClient,
  timeoutMs: number
): Promise<"stored" | "gone" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A stored session past its expiry makes `getSession` try a refresh, which
  // can hang while offline: past the cap the check counts as inconclusive.
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([client.auth.getSession(), timedOut]);
    if (result === "timeout") return "timeout";
    // An error (a failed refresh) can come with a null session while the
    // credentials stay on disk, so it proves nothing: inconclusive.
    if (result.error) return "stored";
    return result.data.session ? "stored" : "gone";
  } catch {
    return "stored";
  } finally {
    clearTimeout(timer);
  }
}

/** How far the teardown had to go. */
export type SessionEndOutcome =
  /** The server revoked the session and it is gone from the device. */
  | "revoked"
  /** The revoke failed; the session was signed out and is gone locally. */
  | "local"
  /** Both sign-outs failed; the stored session was deleted directly. */
  | "forced"
  /**
   * The stored session could not be shown to be gone (whatever the sign-outs
   * answered): a delete failed, it was still found after every delete, or a
   * check timed out before confirming the delete. It is now blocked. The
   * in-memory state is cleared regardless; the caller reports it.
   */
  | "incomplete"
  /**
   * As "incomplete", but the block could not be stored either: it holds only
   * until the app restarts, when a session that is still stored could be
   * restored.
   */
  | "unprotected";

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
 * session itself and checks it is gone. The check runs after a sign-out that
 * reported success too: supabase-js answers success even when its storage
 * delete failed. The caller still owns UI state (setting the signed-in user
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
    // No blocker means nothing was stored: a surviving session then reads as
    // "unprotected", never as safely blocked.
    blockStoredSession = async () => false,
  }: {
    /**
     * False when another session replaced this one while the teardown ran (a
     * server switch): the after-session-end tasks are then skipped, so they
     * cannot reset the replacement account's state.
     */
    stillCurrent?: () => boolean;
    checkTimeoutMs?: number;
    /**
     * Refuses the stored session from now on. Called when the session
     * survived every delete, before the after-session-end tasks, so nothing
     * that runs between can read and cache the old session's token. Resolves
     * true when the block is stored (survives a restart).
     */
    blockStoredSession?: () => Promise<boolean>;
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
    }
  }
  // Delete and verify on every outcome: a sign-out that reported success may
  // still have left the session on disk. The deletion happens outside
  // supabase-js's auth lock, so a token refresh that was already running can
  // write the session back: delete, check under the lock, delete again if it
  // came back.
  let stored = true;
  for (let check = 0; check <= FORCED_TEARDOWN_CHECKS && stored; check++) {
    let removed = true;
    try {
      await removePersistedSession();
    } catch {
      // An unverifiable delete proves nothing: the session counts as still
      // stored whatever a session read says (the storage adapter reads a
      // failing store as "nothing stored").
      removed = false;
    }
    const found = await sessionStillStored(client, checkTimeoutMs);
    stored = !removed || found !== "gone";
    // A check that timed out will time out again (a refresh hanging
    // offline): stop re-checking, so a sign-out waits one timeout, not
    // three. The delete is then unconfirmed, so the session is blocked as if
    // it were still stored.
    if (found === "timeout") break;
  }
  if (stored) {
    let blockStored = false;
    try {
      blockStored = await blockStoredSession();
    } catch {
      // Reported by the caller through the "unprotected" outcome.
    }
    outcome = blockStored ? "incomplete" : "unprotected";
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
