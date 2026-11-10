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

/**
 * Key of a second, write-only-when-needed list: keys blocked while the main
 * list could not be read. Merged into the main list on the next good read, so
 * such a block still survives a restart.
 */
export const BLOCKED_SESSION_KEYS_PENDING =
  "shelf_blocked_session_keys_pending";

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
  /** Keys blocked or unblocked before the store could be read. */
  const pending = new Set<string>();

  /** Parses a stored key list; anything malformed reads as empty. */
  function parseKeys(raw: string | null): string[] {
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((k): k is string => typeof k === "string")
        : [];
    } catch {
      return [];
    }
  }

  async function load(): Promise<Set<string>> {
    if (blocked) return blocked;
    let raw: string | null;
    try {
      raw = await store.getItem(BLOCKED_SESSION_KEYS);
    } catch {
      // Not cached: the next call reads the store again. Keys blocked in this
      // app session stay in `pending` meanwhile.
      return new Set(pending);
    }
    let parked: string[] = [];
    try {
      parked = parseKeys(await store.getItem(BLOCKED_SESSION_KEYS_PENDING));
    } catch {
      parked = [];
    }
    blocked = new Set([...parseKeys(raw), ...parked, ...pending]);
    if (parked.length > 0 && (await save(blocked))) {
      // The parked keys are in the main list now; clear the parked list only
      // once that write succeeded, so a block is never in neither list.
      try {
        await store.setItem(BLOCKED_SESSION_KEYS_PENDING, "[]");
      } catch {
        // Harmless: the next good read folds them in again.
      }
    }
    return blocked;
  }

  /**
   * Rewrites the parked list as what it holds now plus `add`, minus `remove`,
   * so a write never drops keys parked by an earlier app run.
   */
  async function updateParked(change: {
    add?: string;
    remove?: string;
  }): Promise<void> {
    try {
      let parked: string[] = [];
      try {
        parked = parseKeys(await store.getItem(BLOCKED_SESSION_KEYS_PENDING));
      } catch {
        parked = [];
      }
      const next = new Set(parked);
      if (change.add) next.add(change.add);
      if (change.remove) next.delete(change.remove);
      await store.setItem(
        BLOCKED_SESSION_KEYS_PENDING,
        JSON.stringify([...next])
      );
    } catch {
      // The in-memory state still holds for this app session.
    }
  }

  /** Writes the main list. Returns false when the write failed. */
  async function save(keys: Set<string>): Promise<boolean> {
    try {
      await store.setItem(BLOCKED_SESSION_KEYS, JSON.stringify([...keys]));
      return true;
    } catch {
      // The in-memory block still holds for this app session.
      return false;
    }
  }

  return {
    async block(storageKey) {
      pending.add(storageKey);
      // Retry the read once when it failed.
      let keys = await load();
      if (!blocked) keys = await load();
      keys.add(storageKey);
      // Only a list read from the store is written back, so a failed read can
      // never overwrite the stored list with a partial one. When the read
      // still fails, the block is parked in a separate list that the next
      // good read merges in, so it survives a restart.
      if (blocked && (await save(keys))) return;
      await updateParked({ add: storageKey });
    },
    async unblock(storageKey) {
      pending.delete(storageKey);
      const keys = await load();
      if (keys.delete(storageKey) && blocked) await save(keys);
      // A parked block for this key must not come back on the next read.
      if (!blocked) await updateParked({ remove: storageKey });
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
