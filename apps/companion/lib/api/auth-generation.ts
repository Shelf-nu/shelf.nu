/**
 * A counter that moves when a session ends or the signed-in account changes,
 * and stays put on a token refresh.
 *
 * Work that started under one generation (a session read, a cached response)
 * must not be used once the generation has moved: it belongs to a session that
 * is over. A token refresh keeps the same session, and `getSession` can
 * trigger one itself, so a refresh never moves the counter.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./auth-generation.test.ts}
 * @see {@link file://./client.ts} the access-token cache
 */

/** The generation counter. */
export type AuthGeneration = {
  /** The current generation. */
  current: () => number;
  /**
   * Reports the user an auth event carries. Moves the generation when the
   * user differs from the last one reported (sign-out, another account); the
   * first report and a repeat of the same user (a refresh) leave it.
   *
   * @param userId - The user's id, or null when signed out
   * @returns True when the generation moved
   */
  observe: (userId: string | null) => boolean;
  /** Moves the generation (a session ended without an auth event). */
  bump: () => void;
  /** Forgets the last user, for a new client whose first event is not a change. */
  forgetUser: () => void;
};

/**
 * Creates a generation counter.
 *
 * @returns The counter, at generation 0 with no user seen
 */
export function createAuthGeneration(): AuthGeneration {
  let generation = 0;
  let lastUserId: string | null | undefined;
  return {
    current: () => generation,
    observe(userId) {
      const changed = lastUserId !== undefined && userId !== lastUserId;
      if (changed) generation += 1;
      lastUserId = userId;
      return changed;
    },
    bump() {
      generation += 1;
    },
    forgetUser() {
      lastUserId = undefined;
    },
  };
}
