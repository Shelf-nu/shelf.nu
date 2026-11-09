/**
 * Tests for ending a session on the device: whatever the server answers, the
 * stored session is gone and the after-session-end tasks run.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./end-session.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endSessionOnDevice, type SessionEndingClient } from "./end-session";
import { onAfterSessionEnd } from "./session-end";

type Answer = "ok" | "error" | "throw";

/**
 * A stub client whose sign-outs answer as told, and which removes its stored
 * session only when supabase-js would (a sign-out with no error).
 */
function stubClient(global: Answer, local: Answer) {
  const state = { stored: true, scopes: [] as string[] };
  const client: SessionEndingClient = {
    auth: {
      signOut: async (options) => {
        const scope = options?.scope ?? "global";
        state.scopes.push(scope);
        const answer = scope === "local" ? local : global;
        if (answer === "throw") throw new Error("network");
        if (answer === "error") return { error: new Error("offline") };
        state.stored = false;
        return { error: null };
      },
    },
  };
  const removeStored = async () => {
    state.stored = false;
  };
  return { client, state, removeStored };
}

describe("endSessionOnDevice", () => {
  it("stops after a successful revoke", async () => {
    const { client, state, removeStored } = stubClient("ok", "ok");

    assert.equal(await endSessionOnDevice(client, removeStored), "revoked");
    assert.deepEqual(state.scopes, ["global"]);
    assert.equal(state.stored, false);
  });

  it("falls back to a local sign-out when the revoke fails", async () => {
    for (const failure of ["error", "throw"] as const) {
      const { client, state, removeStored } = stubClient(failure, "ok");

      assert.equal(await endSessionOnDevice(client, removeStored), "local");
      assert.deepEqual(state.scopes, ["global", "local"]);
      assert.equal(state.stored, false);
    }
  });

  it("deletes the stored session when both sign-outs fail", async () => {
    const { client, state, removeStored } = stubClient("error", "error");

    assert.equal(await endSessionOnDevice(client, removeStored), "forced");
    assert.equal(state.stored, false);
  });

  it("never rejects, even when deleting the stored session throws", async () => {
    const { client } = stubClient("throw", "throw");

    const outcome = await endSessionOnDevice(client, async () => {
      throw new Error("keychain");
    });

    assert.equal(outcome, "forced");
  });

  it("runs the after-session-end tasks on every outcome", async () => {
    let runs = 0;
    const unregister = onAfterSessionEnd(() => {
      runs += 1;
    });
    const unregisterFailing = onAfterSessionEnd(() => {
      throw new Error("cleanup");
    });

    for (const [global, local] of [
      ["ok", "ok"],
      ["error", "ok"],
      ["error", "error"],
    ] as const) {
      const { client, removeStored } = stubClient(global, local);
      await endSessionOnDevice(client, removeStored);
    }
    unregister();
    unregisterFailing();

    assert.equal(runs, 3);
  });
});
