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
   * session and lifts the block only when the removal is verified. Never
   * rejects; on failure the block stays.
   *
   * @param storageKey - The session storage key the sign-in will write
   * @returns True when the key is writable (it was not blocked, or the block
   *   was lifted); false when it is still blocked
   */
  prepareSignIn: (storageKey: string) => Promise<boolean>;
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
    await deleteChunks(key);
  }

  /** Deletes a value's chunk set only. Throws on a store error. */
  async function deleteChunks(key: string): Promise<void> {
    const countStr = await store.getItemAsync(`${key}_chunks`);
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    for (let i = 0; i < count; i++) {
      await store.deleteItemAsync(`${key}_chunk_${i}`);
    }
    await store.deleteItemAsync(`${key}_chunks`);
  }

  /**
   * Writes a value, chunking it when long. Throws on a store error.
   *
   * The new value overwrites in place wherever it can, so a write that fails
   * part-way leaves the previous session readable rather than nothing at all:
   * a short value replaces the direct key (old chunks are dropped first,
   * since a direct value wins on read anyway); a long value writes its chunks
   * and count, and only then drops the direct key that would shadow them.
   */
  async function writeStrict(key: string, value: string): Promise<void> {
    if (value.length <= chunkSize) {
      await deleteChunks(key);
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
    await store.deleteItemAsync(key);
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

  async function prepareSignIn(storageKey: string): Promise<boolean> {
    if (!(await block.isBlocked(storageKey))) return true;
    try {
      await removeSession(storageKey);
    } catch (error) {
      onError("prepareSignIn", storageKey, error);
      return false; // the old session may still be stored: keep it refused
    }
    await block.unblock(storageKey);
    return true;
  }

  return { adapter, removeSession, prepareSignIn };
}

/**
 * The message a sign-in returns when the session key is still blocked: the
 * previous sign-in could not be removed from the phone, so a new session
 * written now would be refused on every read.
 */
export const PREVIOUS_SIGN_IN_NOT_CLEARED =
  "This phone could not clear the previous sign-in. Restart the app and try again.";

/** The message a sign-in returns when the server changed while it ran. */
export const SERVER_CHANGED_DURING_SIGN_IN =
  "The server changed during sign-in. Please try again.";

/**
 * Runs one sign-in the same way on every sign-in path (password and SSO):
 * prepares the stored session key first (`prepareSignIn`), then signs in only
 * if that worked and the server did not change meanwhile.
 *
 * @param options.prepare - Prepares the session key (`prepareSignIn`);
 *   false means it is still blocked
 * @param options.serverUnchanged - True while the server is the one the
 *   sign-in started on
 * @param options.signIn - The sign-in itself
 * @returns The sign-in's result, or the not-cleared or server-changed error
 */
export async function signInWithPreparedSession<
  T extends { error: string | null },
>({
  prepare,
  serverUnchanged,
  signIn,
}: {
  prepare: () => Promise<boolean>;
  serverUnchanged: () => boolean;
  signIn: () => Promise<T>;
}): Promise<T | { error: string }> {
  if (!(await prepare())) return { error: PREVIOUS_SIGN_IN_NOT_CLEARED };
  if (!serverUnchanged()) return { error: SERVER_CHANGED_DURING_SIGN_IN };
  return signIn();
}
