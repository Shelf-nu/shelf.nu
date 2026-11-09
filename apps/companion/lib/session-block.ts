/**
 * Stored sessions the app refuses to restore.
 *
 * When a sign-out could not delete the stored session (both supabase-js
 * sign-outs failed and every delete failed too), its storage key is recorded
 * here, in a separate store. The session storage adapter (`./supabase.ts`)
 * then answers "nothing stored" for that key, and deletes it, on every read,
 * so neither a restart nor a late token refresh can bring the previous person
 * back on a shared phone. Signing in clears the block first
 * ({@link SessionBlock.unblock}), because a new session is written under the
 * same key.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it; the store is injected.
 *
 * @see {@link file://./session-block.test.ts}
 * @see {@link file://./supabase.ts}
 */

/** Key, in the injected store, of the list of blocked session keys. */
export const BLOCKED_SESSION_KEYS = "shelf_blocked_session_keys";

/** The slice of a key-value store this module needs (AsyncStorage). */
export type BlockStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/** The set of blocked session keys. */
export type SessionBlock = {
  /**
   * Blocks a session storage key and every key derived from it.
   *
   * @param storageKey - The client's session storage key
   */
  block: (storageKey: string) => Promise<void>;
  /**
   * Lifts the block on a session storage key, before a sign-in.
   *
   * @param storageKey - The client's session storage key
   */
  unblock: (storageKey: string) => Promise<void>;
  /**
   * Whether a storage key read must be refused.
   *
   * @param key - The key being read (the session key or a derived one)
   * @returns True when it is a blocked session key or derived from one
   */
  isBlocked: (key: string) => Promise<boolean>;
};

/**
 * Creates the block list over a store, loading it once.
 *
 * @param store - Where the list persists (AsyncStorage in the app)
 * @returns The block list. Its methods never reject: a store failure counts
 *   as "not blocked" on read and is ignored on write.
 */
export function createSessionBlock(store: BlockStore): SessionBlock {
  let blocked: Set<string> | null = null;

  async function load(): Promise<Set<string>> {
    if (blocked) return blocked;
    try {
      const raw = await store.getItem(BLOCKED_SESSION_KEYS);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      blocked = new Set(
        Array.isArray(parsed)
          ? parsed.filter((k): k is string => typeof k === "string")
          : []
      );
    } catch {
      blocked = new Set();
    }
    return blocked;
  }

  async function save(keys: Set<string>): Promise<void> {
    try {
      await store.setItem(BLOCKED_SESSION_KEYS, JSON.stringify([...keys]));
    } catch {
      // The in-memory block still holds for this app session.
    }
  }

  return {
    async block(storageKey) {
      const keys = await load();
      keys.add(storageKey);
      await save(keys);
    },
    async unblock(storageKey) {
      const keys = await load();
      if (keys.delete(storageKey)) await save(keys);
    },
    async isBlocked(key) {
      const keys = await load();
      for (const base of keys) {
        if (key === base || key.startsWith(`${base}-`)) return true;
      }
      return false;
    },
  };
}
