/**
 * Background-write concurrency limiter (process-wide).
 *
 * Some loader/read paths defer non-critical DB writes to a fire-and-forget
 * background task so they don't hold a Prisma connection on the awaited path
 * (part of the P2024 pool-exhaustion fix — see
 * {@link file://./../modules/asset/service.server.ts} `refreshExpiredAssetImages`
 * and {@link file://./../modules/team-member/service.server.ts}
 * `fixTeamMembersNames`).
 *
 * The Prisma connection pool (connection_limit 30) is per-process, so a
 * per-request or per-feature write cap gives false protection: N concurrent
 * requests — or two different features each capping themselves at 3 — could
 * still aggregate into a burst that drains the pool and starves the very reads
 * the deferral is meant to protect. Routing EVERY background write through this
 * single module-level budget guarantees that no more than
 * {@link MAX_CONCURRENT_BACKGROUND_WRITES} background writes hold a connection
 * at any instant, process-wide, across all features and all requests.
 *
 * Deliberate trade-off vs. a per-write timeout: because Prisma has no query
 * cancellation, racing each write against a timeout would free the logical slot
 * while the DB connection stayed held — breaking this very cap. The limiter is
 * the stronger guarantee (hung writes stay capped; reads keep the rest of the
 * pool).
 *
 * @see {@link file://./../modules/asset/service.server.ts}
 * @see {@link file://./../modules/team-member/service.server.ts}
 */

/** Max background writes allowed to hold a connection at once, process-wide. */
export const MAX_CONCURRENT_BACKGROUND_WRITES = 3;

/** In-flight background writes (0..MAX_CONCURRENT_BACKGROUND_WRITES). */
let activeBackgroundWrites = 0;

/** Resolvers for callers parked until a slot frees up (FIFO). */
const backgroundWriteWaiters: Array<() => void> = [];

/**
 * Acquire a background-write slot, resolving immediately when the process-wide
 * cap has headroom, or parking the caller in a FIFO queue until a slot frees.
 *
 * The capacity check and increment run synchronously with no `await` between
 * them, so — JS being single-threaded — there is no check-then-act race.
 *
 * @returns A promise that resolves once a slot is held by the caller.
 */
function acquireBackgroundWriteSlot(): Promise<void> {
  if (activeBackgroundWrites < MAX_CONCURRENT_BACKGROUND_WRITES) {
    activeBackgroundWrites += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    backgroundWriteWaiters.push(resolve);
  });
}

/**
 * Release a background-write slot. If a caller is waiting, the slot is handed
 * straight to it (the active count stays constant); otherwise the active count
 * is decremented.
 */
function releaseBackgroundWriteSlot(): void {
  const next = backgroundWriteWaiters.shift();
  if (next) {
    next();
  } else {
    activeBackgroundWrites -= 1;
  }
}

/**
 * Run `fn` while holding a process-wide background-write slot, releasing the
 * slot whether `fn` resolves or rejects. Errors propagate to the caller so each
 * call site decides how to handle a failed background write.
 *
 * @param fn - The background write to run under the shared concurrency budget.
 * @returns The resolved value of `fn`.
 */
export async function withBackgroundWriteSlot<T>(
  fn: () => Promise<T>
): Promise<T> {
  await acquireBackgroundWriteSlot();
  try {
    return await fn();
  } finally {
    releaseBackgroundWriteSlot();
  }
}
