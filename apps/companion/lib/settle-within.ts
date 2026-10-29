/**
 * Runs a batch of tasks under a time cap, for work that must never hold up
 * or fail its caller (the tasks that run before a sign-out).
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./settle-within.test.ts}
 * @see {@link file://./server/session-end.ts} `runBeforeSessionEnd`, the caller
 */

/**
 * Starts every task and resolves once all have settled or `capMs` has
 * passed, whichever comes first.
 *
 * Never rejects: a task that throws synchronously, rejects or never settles
 * cannot fail the batch, stop the other tasks, or hold the caller past the
 * cap.
 *
 * @param tasks - The work to run, all started at once
 * @param capMs - The longest the caller waits, in milliseconds
 * @returns Resolves when the batch is done or the cap is reached
 */
export async function settleWithin(
  tasks: Iterable<() => unknown>,
  capMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, capMs);
  });
  const batch = Promise.allSettled(
    [...tasks].map((task) => Promise.resolve().then(task))
  );
  try {
    await Promise.race([batch, cap]);
  } finally {
    clearTimeout(timer);
  }
}
