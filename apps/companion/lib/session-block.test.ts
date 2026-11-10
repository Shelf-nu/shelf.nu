/**
 * Tests for the blocked-session list.
 *
 * @see ./session-block.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BLOCKED_SESSION_KEYS, createSessionBlock } from "./session-block";

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

  it("survives a restart through the store", async () => {
    const store = mapStore();
    await createSessionBlock(store).block("sb-abcd-auth-token");

    const afterRestart = createSessionBlock(store);

    assert.equal(await afterRestart.isBlocked("sb-abcd-auth-token"), true);
  });

  it("unblock lifts it, for the next sign-in", async () => {
    const store = mapStore();
    const block = createSessionBlock(store);
    await block.block("sb-abcd-auth-token");

    await block.unblock("sb-abcd-auth-token");

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
});
