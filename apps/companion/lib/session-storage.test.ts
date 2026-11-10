/**
 * Tests for the session storage: the adapter's block guard, the verified
 * session delete, and the sign-in preparation that lifts a block.
 *
 * @see ./session-storage.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createSessionBlock } from "./session-block";
import {
  createSessionStorage,
  PREVIOUS_SIGN_IN_NOT_CLEARED,
  SERVER_CHANGED_DURING_SIGN_IN,
  signInWithPreparedSession,
} from "./session-storage";

const KEY = "sb-abcd-auth-token";
const OTHER = "sb-other-auth-token";

/** A Map-backed secure store whose operations can be made to fail. */
function fakeStore() {
  const data = new Map<string, string>();
  const fail = { get: false, set: false, delete: false };
  const deleted: string[] = [];
  return {
    data,
    fail,
    deleted,
    getItemAsync: async (key: string) => {
      if (fail.get) throw new Error("keychain read");
      return data.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      if (fail.set) throw new Error("keychain write");
      data.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      if (fail.delete) throw new Error("keychain delete");
      deleted.push(key);
      data.delete(key);
    },
  };
}

/** A Map-backed block-list store (AsyncStorage). */
function blockStore() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

let store: ReturnType<typeof fakeStore>;
let block: ReturnType<typeof createSessionBlock>;
let storage: ReturnType<typeof createSessionStorage>;

beforeEach(() => {
  store = fakeStore();
  block = createSessionBlock(blockStore());
  storage = createSessionStorage({ store, block, chunkSize: 10 });
});

describe("adapter", () => {
  it("passes an unblocked key through, chunking long values", async () => {
    await storage.adapter.setItem(KEY, "a-long-session-value");

    assert.equal(store.data.get(`${KEY}_chunks`), "2");
    assert.equal(await storage.adapter.getItem(KEY), "a-long-session-value");
  });

  it("reads a blocked key as nothing and deletes it", async () => {
    await storage.adapter.setItem(KEY, "old");
    await block.block(KEY);

    assert.equal(await storage.adapter.getItem(KEY), null);
    assert.equal(store.data.has(KEY), false);
  });

  it("swallows store errors, as supabase-js expects", async () => {
    store.fail.get = true;
    assert.equal(await storage.adapter.getItem(KEY), null);
    store.fail.set = true;
    await storage.adapter.setItem(KEY, "x");
  });
});

describe("removeSession", () => {
  it("deletes every key of the given session and no other", async () => {
    await storage.adapter.setItem(KEY, "session");
    await storage.adapter.setItem(`${KEY}-user`, "user");
    await storage.adapter.setItem(`${KEY}-code-verifier`, "v");
    await storage.adapter.setItem(OTHER, "other session");

    await storage.removeSession(KEY);

    assert.deepEqual(
      [...store.data.keys()].filter((k) => k.startsWith(KEY)),
      []
    );
    assert.equal(await storage.adapter.getItem(OTHER), "other session");
  });

  it("throws when the delete cannot be verified", async () => {
    await storage.adapter.setItem(KEY, "session");
    store.fail.delete = true;

    await assert.rejects(storage.removeSession(KEY));
  });

  it("throws when the read-back fails, instead of trusting it", async () => {
    await storage.adapter.setItem(KEY, "session");
    const realDelete = store.deleteItemAsync;
    store.deleteItemAsync = async () => {}; // the delete silently keeps it
    store.fail.get = false;

    await assert.rejects(storage.removeSession(KEY));

    store.deleteItemAsync = realDelete;
    store.fail.get = true; // the store cannot even be read
    await assert.rejects(storage.removeSession(KEY));
  });
});

describe("prepareSignIn", () => {
  it("keeps a blocked key unreadable until a new session is written", async () => {
    await storage.adapter.setItem(KEY, "previous person");
    await block.block(KEY);

    assert.equal(await storage.prepareSignIn(KEY), true);

    assert.equal(await storage.adapter.getItem(KEY), null);
    await storage.adapter.setItem(KEY, "new person");
    assert.equal(await storage.adapter.getItem(KEY), "new person");
  });

  it("keeps the block when the old session cannot be removed", async () => {
    await storage.adapter.setItem(KEY, "previous person");
    await block.block(KEY);
    store.fail.delete = true;

    assert.equal(await storage.prepareSignIn(KEY), false);

    assert.equal(await block.isBlocked(KEY), true);
    store.fail.delete = false;
    assert.equal(await storage.adapter.getItem(KEY), null);
  });

  it("does nothing for a key that is not blocked", async () => {
    await storage.adapter.setItem(KEY, "current session");
    store.deleted.length = 0;

    await storage.prepareSignIn(KEY);

    assert.equal(await storage.adapter.getItem(KEY), "current session");
    assert.deepEqual(store.deleted, []);
  });
});

describe("signInWithPreparedSession", () => {
  it("prepares the key, then signs in", async () => {
    const calls: string[] = [];
    const result = await signInWithPreparedSession({
      prepare: async () => {
        calls.push("prepare");
        return true;
      },
      serverUnchanged: () => true,
      signIn: async () => {
        calls.push("sign-in");
        return { error: null };
      },
    });

    assert.deepEqual(calls, ["prepare", "sign-in"]);
    assert.deepEqual(result, { error: null });
  });

  it("stops before sending credentials when the server changed", async () => {
    let signedIn = false;
    const result = await signInWithPreparedSession({
      prepare: async () => true,
      serverUnchanged: () => false,
      signIn: async () => {
        signedIn = true;
        return { error: null };
      },
    });

    assert.equal(signedIn, false);
    assert.deepEqual(result, { error: SERVER_CHANGED_DURING_SIGN_IN });
  });

  it("does not sign in while the previous sign-in is still blocked", async () => {
    let signedIn = false;
    const result = await signInWithPreparedSession({
      prepare: async () => false,
      serverUnchanged: () => true,
      signIn: async () => {
        signedIn = true;
        return { error: null };
      },
    });

    assert.equal(signedIn, false);
    assert.deepEqual(result, { error: PREVIOUS_SIGN_IN_NOT_CLEARED });
  });
});

describe("adapter writes", () => {
  it("keeps the previous session when writing a new one fails", async () => {
    await storage.adapter.setItem(KEY, "previous");
    store.fail.set = true;

    await storage.adapter.setItem(KEY, "new");
    store.fail.set = false;

    assert.equal(await storage.adapter.getItem(KEY), "previous");
  });

  it("replaces a chunked value with a short one and the reverse", async () => {
    await storage.adapter.setItem(KEY, "a-long-session-value");
    await storage.adapter.setItem(KEY, "short");
    assert.equal(await storage.adapter.getItem(KEY), "short");
    assert.equal(store.data.has(`${KEY}_chunks`), false);

    await storage.adapter.setItem(KEY, "another-long-value");
    assert.equal(await storage.adapter.getItem(KEY), "another-long-value");
    assert.equal(store.data.has(KEY), false);
  });

  it("never leaves a short old value shadowing a new long one", async () => {
    await storage.adapter.setItem(KEY, "short");
    store.fail.delete = true;

    await storage.adapter.setItem(KEY, "a-much-longer-new-session");
    store.fail.delete = false;

    // The write stopped before writing chunks: the old value is still the one
    // read, and no half-written chunk set is left behind.
    assert.equal(await storage.adapter.getItem(KEY), "short");
    assert.equal(store.data.has(`${KEY}_chunks`), false);
  });
});
