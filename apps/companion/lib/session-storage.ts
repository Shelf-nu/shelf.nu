/**
 * Where a Supabase session lives on the device, and the rules for removing it.
 *
 * Three pieces, built over an injected key-value store (SecureStore on the
 * phone, localStorage on web) and the block list of `./session-block.ts`:
 *
 * - `adapter` is the storage supabase-js reads and writes. Values longer than
 *   `chunkSize` are split across numbered chunk keys. A read of a blocked
 *   session key answers "nothing stored" and retries the delete. Errors are
 *   swallowed, as supabase-js expects.
 * - `removeSession` deletes every key of one session and then reads them back.
 *   It throws when a delete or a read-back fails, or when anything is left, so
 *   a sign-out can tell a verified delete from an unverifiable one.
 * - `prepareSignIn` runs before a sign-in writes a new session under a key a
 *   past sign-out blocked: it removes the old session with `removeSession`
 *   and lifts the block only when that succeeded. The old session is never
 *   readable in between.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./session-storage.test.ts}
 * @see {@link file://./supabase.ts} the wiring
 * @see {@link file://./session-block.ts}
 */
import type { SessionBlock } from "./session-block";
import { sessionStorageKeys } from "./session-storage-keys";

/** The slice of a secure key-value store this module needs. */
export type SecureKeyValueStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

/** The storage interface supabase-js uses for its session. */
export type SessionStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** What {@link createSessionStorage} returns. */
export type SessionStorage = {
  adapter: SessionStorageAdapter;
  /**
   * Deletes every key of a session and verifies they are gone.
   *
   * @param storageKey - The session storage key
   * @throws When a delete or read-back fails, or a value is still stored
   */
  removeSession: (storageKey: string) => Promise<void>;
  /**
   * Makes a blocked session key writable for a sign-in: removes the old
   * session and lifts the block only when the removal is verified. A no-op
   * for a key that is not blocked. Never rejects; on failure the block stays.
   *
   * @param storageKey - The session storage key the sign-in will write
   */
  prepareSignIn: (storageKey: string) => Promise<void>;
};

/**
 * Builds the session storage over a store and a block list.
 *
 * @param options.store - The secure key-value store
 * @param options.block - The blocked-session list
 * @param options.chunkSize - Longest value stored under one key
 * @param options.onError - Called with every swallowed adapter error
 * @returns The adapter and the session helpers
 */
export function createSessionStorage({
  store,
  block,
  chunkSize = 2000,
  onError = () => {},
}: {
  store: SecureKeyValueStore;
  block: SessionBlock;
  chunkSize?: number;
  onError?: (operation: string, key: string, error: unknown) => void;
}): SessionStorage {
  /** Reads a value, reassembling chunks. Throws on a store error. */
  async function readStrict(key: string): Promise<string | null> {
    const direct = await store.getItemAsync(key);
    if (direct !== null) return direct;
    const countStr = await store.getItemAsync(`${key}_chunks`);
    if (!countStr) return null;
    const count = parseInt(countStr, 10);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await store.getItemAsync(`${key}_chunk_${i}`);
      if (part === null) return null; // a broken chunk set reads as nothing
      parts.push(part);
    }
    return parts.join("");
  }

  /** Deletes a value and all its chunks. Throws on a store error. */
  async function deleteStrict(key: string): Promise<void> {
    await store.deleteItemAsync(key);
    const countStr = await store.getItemAsync(`${key}_chunks`);
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    for (let i = 0; i < count; i++) {
      await store.deleteItemAsync(`${key}_chunk_${i}`);
    }
    await store.deleteItemAsync(`${key}_chunks`);
  }

  /** Writes a value, chunking it when long. Throws on a store error. */
  async function writeStrict(key: string, value: string): Promise<void> {
    // Clear any previous value first, so a stale direct value or stale tail
    // chunks can never shadow or corrupt the new one.
    await deleteStrict(key);
    if (value.length <= chunkSize) {
      await store.setItemAsync(key, value);
      return;
    }
    const chunks = Math.ceil(value.length / chunkSize);
    for (let i = 0; i < chunks; i++) {
      await store.setItemAsync(
        `${key}_chunk_${i}`,
        value.slice(i * chunkSize, (i + 1) * chunkSize)
      );
    }
    await store.setItemAsync(`${key}_chunks`, String(chunks));
  }

  const adapter: SessionStorageAdapter = {
    async getItem(key) {
      if (await block.isBlocked(key)) {
        // A sign-out could not delete this session: refuse it, and retry
        // the delete.
        await adapter.removeItem(key);
        return null;
      }
      try {
        return await readStrict(key);
      } catch (error) {
        onError("getItem", key, error);
        return null;
      }
    },
    async setItem(key, value) {
      try {
        await writeStrict(key, value);
      } catch (error) {
        onError("setItem", key, error);
      }
    },
    async removeItem(key) {
      try {
        await deleteStrict(key);
      } catch (error) {
        onError("removeItem", key, error);
      }
    },
  };

  async function removeSession(storageKey: string): Promise<void> {
    const keys = sessionStorageKeys(storageKey);
    for (const key of keys) await deleteStrict(key);
    for (const key of keys) {
      if ((await readStrict(key)) !== null) {
        throw new Error(`session key still stored: ${key}`);
      }
    }
  }

  async function prepareSignIn(storageKey: string): Promise<void> {
    if (!(await block.isBlocked(storageKey))) return;
    try {
      await removeSession(storageKey);
    } catch (error) {
      onError("prepareSignIn", storageKey, error);
      return; // the old session may still be stored: keep it refused
    }
    await block.unblock(storageKey);
  }

  return { adapter, removeSession, prepareSignIn };
}

/** The message a sign-in returns when the server changed while it ran. */
export const SERVER_CHANGED_DURING_SIGN_IN =
  "The server changed during sign-in. Please try again.";

/**
 * Runs one sign-in the same way on every sign-in path (password and SSO):
 * prepares the stored session key first (`prepareSignIn`), then signs in only
 * if the server did not change meanwhile.
 *
 * @param options.prepare - Prepares the session key (`prepareSignIn`)
 * @param options.serverUnchanged - True while the server is the one the
 *   sign-in started on
 * @param options.signIn - The sign-in itself
 * @returns The sign-in's result, or the server-changed error
 */
export async function signInWithPreparedSession<
  T extends { error: string | null },
>({
  prepare,
  serverUnchanged,
  signIn,
}: {
  prepare: () => Promise<void>;
  serverUnchanged: () => boolean;
  signIn: () => Promise<T>;
}): Promise<T | { error: string }> {
  await prepare();
  if (!serverUnchanged()) return { error: SERVER_CHANGED_DURING_SIGN_IN };
  return signIn();
}
