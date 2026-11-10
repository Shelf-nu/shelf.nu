/**
 * Tests for the blocked-session list.
 *
 * @see ./session-block.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BLOCKED_SESSION_KEYS,
  BLOCKED_SESSION_KEYS_PENDING,
  createSessionBlock,
} from "./session-block";

/** A Map-backed store, standing in for AsyncStorage. */
function mapStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("createSessionBlock", () => {
  it("blocks a session key and the keys derived from it", async () => {
    const block = createSessionBlock(mapStore());
    await block.block("sb-abcd-auth-token");

    assert.equal(await block.isBlocked("sb-abcd-auth-token"), true);
    assert.equal(await block.isBlocked("sb-abcd-auth-token-user"), true);
    assert.equal(await block.isBlocked("sb-other-auth-token"), false);
    assert.equal(await block.isBlocked("sb-abcd-auth-tokenX"), false);
  });

  it("does not block another server's key that shares the prefix", async () => {
    const block = createSessionBlock(mapStore());
    await block.block("sb-x-auth-token");

    assert.equal(await block.isBlocked("sb-x-auth-token-code-verifier"), true);
    assert.equal(await block.isBlocked("sb-x-auth-token-user"), true);
    assert.equal(
      await block.isBlocked("sb-x-auth-token-prod-auth-token"),
      false
    );
    assert.equal(
      await block.isBlocked("sb-x-auth-token-prod-auth-token-user"),
      false
    );
  });

  it("survives a restart through the store", async () => {
    const store = mapStore();
    await createSessionBlock(store).block("sb-abcd-auth-token");

    const afterRestart = createSessionBlock(store);

    assert.equal(await afterRestart.isBlocked("sb-abcd-auth-token"), true);
  });

  it("unblock reports a lift it could not store, and keeps the block", async () => {
    const store = mapStore();
    const block = createSessionBlock(store);
    await block.block("sb-abcd-auth-token");
    store.setItem = async () => {
      throw new Error("storage full");
    };

    assert.equal(await block.unblock("sb-abcd-auth-token"), false);

    assert.equal(await block.isBlocked("sb-abcd-auth-token"), true);
    assert.equal(
      await createSessionBlock(store).isBlocked("sb-abcd-auth-token"),
      true
    );
  });

  it("keeps the block in memory when only the parked list cannot be cleared", async () => {
    const key = "sb-abcd-auth-token";
    const store = mapStore({
      [BLOCKED_SESSION_KEYS]: JSON.stringify([key]),
      [BLOCKED_SESSION_KEYS_PENDING]: JSON.stringify([key]),
    });
    const write = store.setItem;
    store.setItem = async (k: string, v: string) => {
      if (k === BLOCKED_SESSION_KEYS_PENDING) throw new Error("storage full");
      await write(k, v);
    };
    const block = createSessionBlock(store);

    assert.equal(await block.unblock(key), false);

    // A second sign-in in the same run must still go through unblock.
    assert.equal(await block.isBlocked(key), true);
  });

  it("unblock lifts it, for the next sign-in", async () => {
    const store = mapStore();
    const block = createSessionBlock(store);
    await block.block("sb-abcd-auth-token");

    assert.equal(await block.unblock("sb-abcd-auth-token"), true);

    assert.equal(await block.isBlocked("sb-abcd-auth-token"), false);
    assert.equal(
      await createSessionBlock(store).isBlocked("sb-abcd-auth-token"),
      false
    );
  });

  it("treats a broken or failing store as nothing blocked", async () => {
    const broken = createSessionBlock(
      mapStore({ [BLOCKED_SESSION_KEYS]: "{not json" })
    );
    assert.equal(await broken.isBlocked("sb-abcd-auth-token"), false);

    const failing = createSessionBlock({
      getItem: async () => {
        throw new Error("disk");
      },
      setItem: async () => {
        throw new Error("disk");
      },
    });
    await failing.block("sb-abcd-auth-token");
    assert.equal(await failing.isBlocked("sb-abcd-auth-token"), true);
  });

  it("retries the read after a failure instead of caching an empty list", async () => {
    const store = mapStore({
      [BLOCKED_SESSION_KEYS]: JSON.stringify(["sb-abcd-auth-token"]),
    });
    let failReads = true;
    const block = createSessionBlock({
      getItem: async (key) => {
        if (failReads) throw new Error("disk");
        return store.getItem(key);
      },
      setItem: store.setItem,
    });

    assert.equal(await block.isBlocked("sb-abcd-auth-token"), false);
    failReads = false;
    assert.equal(await block.isBlocked("sb-abcd-auth-token"), true);
  });

  it("never overwrites the stored list from a failed read", async () => {
    const store = mapStore({
      [BLOCKED_SESSION_KEYS]: JSON.stringify(["sb-abcd-auth-token"]),
    });
    let failReads = true;
    const block = createSessionBlock({
      getItem: async (key) => {
        if (failReads) throw new Error("disk");
        return store.getItem(key);
      },
      setItem: store.setItem,
    });

    await block.block("sb-other-auth-token");
    failReads = false;

    assert.equal(await block.isBlocked("sb-abcd-auth-token"), true);
    assert.equal(await block.isBlocked("sb-other-auth-token"), true);
  });

  it("keeps a block made while the list could not be read across a restart", async () => {
    const store = mapStore({
      [BLOCKED_SESSION_KEYS]: JSON.stringify(["sb-old-auth-token"]),
    });
    let failMainReads = true;
    const flaky = {
      getItem: async (key: string) => {
        if (failMainReads && key === BLOCKED_SESSION_KEYS) {
          throw new Error("disk");
        }
        return store.getItem(key);
      },
      setItem: store.setItem,
    };

    await createSessionBlock(flaky).block("sb-abcd-auth-token");
    assert.ok(store.data.get(BLOCKED_SESSION_KEYS_PENDING));

    failMainReads = false; // the app restarts and storage works again
    const afterRestart = createSessionBlock(flaky);
    assert.equal(await afterRestart.isBlocked("sb-abcd-auth-token"), true);
    assert.equal(await afterRestart.isBlocked("sb-old-auth-token"), true);
    assert.deepEqual(JSON.parse(store.data.get(BLOCKED_SESSION_KEYS)!).sort(), [
      "sb-abcd-auth-token",
      "sb-old-auth-token",
    ]);
  });

  it("saves a block when the read only failed once", async () => {
    const store = mapStore();
    let failures = 1;
    const block = createSessionBlock({
      getItem: async (key) => {
        if (key === BLOCKED_SESSION_KEYS && failures-- > 0) {
          throw new Error("disk");
        }
        return store.getItem(key);
      },
      setItem: store.setItem,
    });

    await block.block("sb-abcd-auth-token");

    assert.deepEqual(JSON.parse(store.data.get(BLOCKED_SESSION_KEYS)!), [
      "sb-abcd-auth-token",
    ]);
  });

  it("a parked block unblocked before storage recovers stays unblocked", async () => {
    const store = mapStore();
    let failMainReads = true;
    const flaky = {
      getItem: async (key: string) => {
        if (failMainReads && key === BLOCKED_SESSION_KEYS) {
          throw new Error("disk");
        }
        return store.getItem(key);
      },
      setItem: store.setItem,
    };
    const block = createSessionBlock(flaky);
    await block.block("sb-abcd-auth-token");

    await block.unblock("sb-abcd-auth-token");
    failMainReads = false;

    assert.equal(
      await createSessionBlock(flaky).isBlocked("sb-abcd-auth-token"),
      false
    );
  });

  it("clears the parked list only after folding it into the main list", async () => {
    const store = mapStore({
      [BLOCKED_SESSION_KEYS_PENDING]: JSON.stringify(["sb-abcd-auth-token"]),
    });
    let failWrites = true;
    const flaky = {
      getItem: store.getItem,
      setItem: async (key: string, value: string) => {
        if (failWrites && key === BLOCKED_SESSION_KEYS) {
          throw new Error("disk");
        }
        return store.setItem(key, value);
      },
    };

    await createSessionBlock(flaky).isBlocked("sb-abcd-auth-token");
    assert.deepEqual(
      JSON.parse(store.data.get(BLOCKED_SESSION_KEYS_PENDING)!),
      ["sb-abcd-auth-token"]
    );

    failWrites = false;
    await createSessionBlock(flaky).isBlocked("sb-abcd-auth-token");
    assert.deepEqual(
      JSON.parse(store.data.get(BLOCKED_SESSION_KEYS_PENDING)!),
      []
    );
    assert.deepEqual(JSON.parse(store.data.get(BLOCKED_SESSION_KEYS)!), [
      "sb-abcd-auth-token",
    ]);
  });

  it("a later run's parked write keeps keys parked by an earlier run", async () => {
    const store = mapStore({
      [BLOCKED_SESSION_KEYS_PENDING]: JSON.stringify(["sb-first-auth-token"]),
    });
    const flaky = {
      getItem: async (key: string) => {
        if (key === BLOCKED_SESSION_KEYS) throw new Error("disk");
        return store.getItem(key);
      },
      setItem: store.setItem,
    };

    await createSessionBlock(flaky).block("sb-second-auth-token");

    assert.deepEqual(
      JSON.parse(store.data.get(BLOCKED_SESSION_KEYS_PENDING)!).sort(),
      ["sb-first-auth-token", "sb-second-auth-token"]
    );
  });
});
