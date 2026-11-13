/**
 * Calls every function in a listener or task set, so that one that throws
 * never stops the rest.
 *
 * Used by the app's small event registries (account changes, session-end
 * tasks, server changes), which must all keep notifying the remaining
 * subscribers when one fails.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./call-each.test.ts}
 */

/**
 * Calls each function in order and reports, rather than rethrows, a throw.
 *
 * @param fns - The listeners or tasks to call
 * @param onError - Called with each thrown error; nothing happens without it
 */
export function callEach(
  fns: Iterable<() => void>,
  onError?: (error: unknown) => void
): void {
  for (const fn of fns) {
    try {
      fn();
    } catch (error) {
      onError?.(error);
    }
  }
}
