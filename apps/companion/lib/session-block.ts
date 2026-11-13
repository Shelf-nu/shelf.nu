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
import { sessionStorageKeys } from "./session-storage-keys";

/** Key, in the injected store, of the list of blocked session keys. */
export const BLOCKED_SESSION_KEYS = "shelf_blocked_session_keys";

/**
 * Prefix of a parked block: a session key blocked while the main list could
 * not be read, stored under its own key so that parking or lifting one never
 * reads or rewrites another. Folded into the main list on the next good read,
 * so such a block still survives a restart.
 */
export const PARKED_BLOCK_KEY_PREFIX = "shelf_blocked_session_parked:";

/**
 * The store key a parked block for one session key lives under.
 *
 * @param storageKey - The blocked session storage key
 * @returns The parked block's own store key
 */
export function parkedBlockKey(storageKey: string): string {
  return `${PARKED_BLOCK_KEY_PREFIX}${storageKey}`;
}

/** The slice of a key-value store this module needs (AsyncStorage). */
export type BlockStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
};

/** The set of blocked session keys. */
export type SessionBlock = {
  /**
   * Blocks a session storage key and the keys supabase-js derives from it
   * (`sessionStorageKeys`).
   *
   * @param storageKey - The client's session storage key
   * @returns True when the block is stored (in the main list or the parked
   *   one), so it survives a restart; false when it holds only in memory for
   *   this app run
   */
  block: (storageKey: string) => Promise<boolean>;
  /**
   * Lifts the block on a session storage key, before a sign-in.
   *
   * @param storageKey - The client's session storage key
   * @returns True only when the lift is stored, so the key is not blocked
   *   again after a restart. On false the key stays blocked, and a new session
   *   written under it would be refused on the next launch.
   */
  unblock: (storageKey: string) => Promise<boolean>;
  /**
   * Whether a storage key read must be refused.
   *
   * @param key - The key being read (the session key or a derived one)
   * @returns True when it is a blocked session key or one of the keys
   *   supabase-js derives from it
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

  /** Whether the parked blocks have been read into `blocked` in this run. */
  let parkedRead = false;

  /**
   * Folds the parked blocks into `blocked` (which must be loaded). A failed
   * listing leaves `parkedRead` false, so the next call lists them again
   * instead of missing a parked block for the rest of the run.
   */
  async function readParked(keys: Set<string>): Promise<void> {
    let parked: string[];
    try {
      parked = (await store.getAllKeys())
        .filter((key) => key.startsWith(PARKED_BLOCK_KEY_PREFIX))
        .map((key) => key.slice(PARKED_BLOCK_KEY_PREFIX.length));
    } catch {
      return;
    }
    parkedRead = true;
    if (parked.length === 0) return;
    for (const key of parked) keys.add(key);
    if (await save(keys)) {
      // The parked blocks are in the main list now; remove them only once
      // that write succeeded, so a block is never in neither place.
      for (const key of parked) {
        try {
          await store.removeItem(parkedBlockKey(key));
        } catch {
          // Harmless: the next good read folds it in again.
        }
      }
    }
  }

  async function load(): Promise<Set<string>> {
    if (blocked) {
      if (!parkedRead) await readParked(blocked);
      return blocked;
    }
    let raw: string | null;
    try {
      raw = await store.getItem(BLOCKED_SESSION_KEYS);
    } catch {
      // Not cached: the next call reads the store again. Keys blocked in this
      // app session stay in `pending` meanwhile.
      return new Set(pending);
    }
    blocked = new Set([...parseKeys(raw), ...pending]);
    await readParked(blocked);
    return blocked;
  }

  /**
   * Parks a block under its own key. Touches no other parked block.
   *
   * @returns False when the write failed (the block then holds only in
   *   memory for this app run)
   */
  async function park(storageKey: string): Promise<boolean> {
    try {
      await store.setItem(parkedBlockKey(storageKey), "1");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Removes a session key's parked block, if any. Touches no other one.
   *
   * @returns False when the removal failed (the parked block may still be
   *   stored, so it comes back on the next launch)
   */
  async function unpark(storageKey: string): Promise<boolean> {
    try {
      await store.removeItem(parkedBlockKey(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /** The last main-list write queued; the next one waits for it. */
  let saveTail: Promise<unknown> = Promise.resolve();

  /**
   * Writes the main list, in call order, with the set as it is at call time.
   * AsyncStorage on Android may finish two writes in either order, and an
   * older snapshot landing last would drop a block added since.
   *
   * @returns False when the write failed
   */
  function save(keys: Set<string>): Promise<boolean> {
    const json = JSON.stringify([...keys]);
    const run = saveTail
      .catch(() => {})
      .then(() => store.setItem(BLOCKED_SESSION_KEYS, json));
    saveTail = run;
    // On a failure the in-memory block still holds for this app session.
    return run.then(
      () => true,
      () => false
    );
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
      // still fails, the block is parked under its own key, which the next
      // good read folds in, so it survives a restart.
      if (blocked && (await save(keys))) return true;
      return park(storageKey);
    },
    async unblock(storageKey) {
      pending.delete(storageKey);
      const keys = await load();
      if (!blocked) {
        // The main list could not be read, so the lift cannot be stored:
        // nothing is lifted, the parked block included, and the key stays
        // blocked for this run too.
        pending.add(storageKey);
        return false;
      }
      const listed = keys.delete(storageKey);
      // The main list is written first and the parked copy removed only after,
      // so a failure at either step leaves a stored block behind: a refused
      // unblock never lifts the block across a restart.
      if (listed && !(await save(keys))) {
        keys.add(storageKey);
        return false;
      }
      // A parked entry that is still stored comes back on the next launch, so
      // the block stays in memory too: the next sign-in then goes through
      // `unblock` again instead of writing a session the next launch refuses.
      if (!(await unpark(storageKey))) {
        keys.add(storageKey);
        // The main list no longer holds the block: write it back, so the
        // refused unblock leaves a stored block even when no parked copy
        // existed.
        if (listed) await save(keys);
        return false;
      }
      return true;
    },
    async isBlocked(key) {
      const keys = await load();
      // Only the exact keys supabase-js derives: another server's key can
      // share the prefix (`sb-x-auth-token-prod-auth-token`).
      for (const base of keys) {
        if (sessionStorageKeys(base).includes(key)) return true;
      }
      return false;
    },
  };
}
