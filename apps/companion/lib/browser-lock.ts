/**
 * Opening the in-app browser past a stale lock.
 *
 * On iOS, expo-web-browser answers `{ type: "locked" }` while it holds a
 * browser session, and it releases the session only when the browser it
 * presented is dismissed. A session whose presentation never completed (a
 * tap while a share sheet or action sheet is still animating away) is never
 * released, so from then on every link would silently open nothing.
 * `openPastStaleLock` releases such a session and opens once more, and
 * `joinOpensInFlight` keeps a double tap from reading the first tap's
 * session as stale.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it. `openShelfWebUrl` in `./navigation.ts` passes the real
 * expo-web-browser calls.
 *
 * @see {@link file://./navigation.ts} `openShelfWebUrl`
 * @see {@link file://./browser-lock.test.ts}
 */

import { settleWithin } from "./settle-within";

/** How long releasing a stale session may take before opening anyway. */
export const RELEASE_CAP_MS = 1000;

/**
 * Opens the browser; when the answer is the locked type, releases the held
 * session (waiting at most `RELEASE_CAP_MS`, ignoring its failure) and opens
 * once more. A browser that really is showing (a page opened from code while
 * another is up) is closed and replaced by the new page, the same outcome
 * as tapping a link inside it. A second locked answer is returned as is, so
 * nothing loops.
 *
 * @param open - Opens the browser and resolves with its result.
 * @param release - Releases the held session (`dismissBrowser`).
 * @param lockedType - The result type that means a session is held.
 * @returns The result of the last open.
 */
export async function openPastStaleLock<Result extends { type: string }>(
  open: () => Promise<Result>,
  release: () => Promise<unknown>,
  lockedType: string
): Promise<Result> {
  const result = await open();
  if (result.type !== lockedType) return result;
  // why: the held session's browser was never shown, so UIKit may never call
  // back from dismissing it; the cap keeps the tap from waiting forever.
  await settleWithin([release], RELEASE_CAP_MS);
  return open();
}

/** How long after a tap a second open joins the first instead of its own. */
export const DOUBLE_TAP_WINDOW_MS = 1000;

/**
 * Wraps an opener so a second call made while the first is still being
 * presented (a double tap) joins the first open instead of starting its
 * own. Without it, the second tap finds the first browser's session held,
 * reads it as stale, and closes and reopens the browser.
 *
 * Only the first `windowMs` count: an open still pending after that is a
 * browser on screen or a session iOS never released, and a new open then
 * runs through `openPastStaleLock` as usual.
 *
 * @param open - Opens a URL and resolves once the browser is dismissed.
 * @param now - The clock, in milliseconds.
 * @param windowMs - How long a pending open absorbs a second call.
 * @returns An opener with the same signature.
 */
export function joinOpensInFlight<Result>(
  open: (url: string) => Promise<Result>,
  now: () => number = Date.now,
  windowMs: number = DOUBLE_TAP_WINDOW_MS
): (url: string) => Promise<Result> {
  let pending: { promise: Promise<Result>; startedAt: number } | null = null;
  return (url) => {
    if (pending && now() - pending.startedAt < windowMs) {
      return pending.promise;
    }
    const entry = { promise: open(url), startedAt: now() };
    pending = entry;
    const settle = () => {
      if (pending === entry) pending = null;
    };
    entry.promise.then(settle, settle);
    return entry.promise;
  };
}
