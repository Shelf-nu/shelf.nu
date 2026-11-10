/**
 * The app's one account-change counter.
 *
 * The access-token cache (`./client.ts`), the response cache (`./cache.ts`)
 * and the audit scan queue (`hooks/use-scan-queue.ts`) all ask the same
 * question: "is the account that started this work still the signed-in one?"
 * They read it from one instance of this counter, so they can never disagree.
 *
 * The counter moves when a different user (or nobody) is reported by an auth
 * event, when a session ends without one (a forced sign-out), and on a server
 * switch. A token refresh for the same user does not move it, and neither does
 * the first auth event of a new client after a switch (the switch itself
 * already moved it).
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it; the auth subscription and lifecycle hooks are injected.
 *
 * @see {@link file://./account-generation.test.ts}
 * @see {@link file://./auth-generation.ts} the counting rule
 */
import { createAuthGeneration } from "./auth-generation";

/** Read access to the account counter, as its consumers use it. */
export type AccountGeneration = {
  /** The current generation. */
  current: () => number;
  /**
   * Calls `listener` every time the generation moves.
   *
   * @param listener - Called with no arguments
   * @returns An unregister function
   */
  onChange: (listener: () => void) => () => void;
};

/**
 * Creates the counter and wires it to the app's lifecycle.
 *
 * @param options.subscribeAuth - Listens to the live client's auth events,
 *   reporting each event's user id (null when signed out); returns an
 *   unsubscribe function. Called again after every server switch.
 * @param options.onSessionEnd - Registers a task for the end of any session
 * @param options.onServerChange - Registers a task for a server switch
 * @returns The counter
 */
export function createAccountGeneration({
  subscribeAuth,
  onSessionEnd,
  onServerChange,
}: {
  subscribeAuth: (listener: (userId: string | null) => void) => () => void;
  onSessionEnd: (task: () => void) => void;
  onServerChange: (task: () => void) => void;
}): AccountGeneration {
  const generation = createAuthGeneration();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // One failing listener must not stop the others.
      }
    }
  };

  const observe = (userId: string | null) => {
    if (generation.observe(userId)) notify();
  };

  let unsubscribe = subscribeAuth(observe);

  onServerChange(() => {
    generation.bump();
    generation.forgetUser();
    unsubscribe();
    unsubscribe = subscribeAuth(observe);
    notify();
  });

  // A sign-out that had to delete the stored session itself emits no auth
  // event, so the end of every session moves the counter too.
  onSessionEnd(() => {
    generation.bump();
    notify();
  });

  return {
    current: () => generation.current(),
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
