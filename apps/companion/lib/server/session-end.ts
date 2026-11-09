/**
 * Work that runs around the end of any session: just before it ends, while
 * its token still works ({@link onBeforeSessionEnd}), and once it has ended
 * ({@link onAfterSessionEnd}).
 *
 * Both paths that end a session call {@link runBeforeSessionEnd} immediately
 * before `auth.signOut()`: the app's own sign-out (`lib/auth-context.tsx`)
 * and the sign-out a server switch performs (`endSessionOnOutgoingClient` in
 * `./active-server.ts`). Tasks are registered from the composition root
 * (`app/_layout.tsx`), because the server module must not import `lib/api/*`.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./session-end.test.ts}
 * @see {@link file://../settle-within.ts} the time cap
 */
import { settleWithin } from "../settle-within";

/** Work that must run while the outgoing session is still valid. */
const beforeSessionEndTasks = new Set<() => Promise<void>>();

/**
 * The longest a sign-out waits for the {@link onBeforeSessionEnd} tasks, all
 * of them together.
 */
export const BEFORE_SESSION_END_CAP_MS = 3_000;

/**
 * Registers work to run just before any session ends: a sign-out from the
 * app, or the sign-out a server switch performs.
 *
 * A task runs while the session's token still works, so it can tell the
 * server something on the person's behalf (forgetting this device for push).
 * Tasks run in parallel. Sign-out waits for them for at most
 * {@link BEFORE_SESSION_END_CAP_MS}, and a task that throws or rejects is
 * ignored.
 *
 * @param task - Async work; its result and errors are ignored
 * @returns An unregister function
 */
export function onBeforeSessionEnd(task: () => Promise<void>): () => void {
  beforeSessionEndTasks.add(task);
  return () => {
    beforeSessionEndTasks.delete(task);
  };
}

/**
 * Runs every task registered with {@link onBeforeSessionEnd}.
 *
 * Call it immediately before `auth.signOut()`, on every path that ends a
 * session.
 *
 * @returns Resolves once every task has settled, or after
 *   {@link BEFORE_SESSION_END_CAP_MS}. Never rejects.
 */
export function runBeforeSessionEnd(): Promise<void> {
  return settleWithin(beforeSessionEndTasks, BEFORE_SESSION_END_CAP_MS);
}

/** Work that drops state tied to an account once its session has ended. */
const afterSessionEndTasks = new Set<() => void>();

/** How many sessions have ended in this app process. */
let sessionsEnded = 0;

/**
 * How many sessions have ended in this app process (sign-outs and server
 * switches). Work that awaits across a sign-out compares this before and
 * after: a different count means the session it started under is gone.
 *
 * @returns The count
 */
export function sessionEndCount(): number {
  return sessionsEnded;
}

/**
 * Registers work to run once any session has ended on this device: a
 * sign-out from the app, or the sign-out a server switch performs.
 *
 * Use it for in-memory state that belongs to the account that just left
 * (cached tokens, cached API responses). It runs even when the server could
 * not be reached, so it must not need the network. A task that throws is
 * ignored.
 *
 * @param task - Synchronous cleanup
 * @returns An unregister function
 */
export function onAfterSessionEnd(task: () => void): () => void {
  afterSessionEndTasks.add(task);
  return () => {
    afterSessionEndTasks.delete(task);
  };
}

/**
 * Runs every task registered with {@link onAfterSessionEnd}.
 *
 * Called by `endSessionOnDevice` (`./end-session.ts`) once the stored session
 * is gone.
 *
 * Never throws.
 */
export function runAfterSessionEnd(): void {
  sessionsEnded += 1;
  for (const task of afterSessionEndTasks) {
    try {
      task();
    } catch {
      // One failing cleanup must not stop the others.
    }
  }
}
