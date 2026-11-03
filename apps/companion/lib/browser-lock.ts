/**
 * Opening the in-app browser past a stale lock.
 *
 * On iOS, expo-web-browser answers `{ type: "locked" }` while it holds a
 * browser session, and it releases the session only when the browser it
 * presented is dismissed. A session whose presentation never completed (a
 * tap while a share sheet or action sheet is still animating away) is never
 * released, so from then on every link would silently open nothing.
 * `openPastStaleLock` releases such a session and opens once more.
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
 * once more. A second locked answer is returned as is: a browser that really
 * is showing stays on top, and nothing loops.
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
