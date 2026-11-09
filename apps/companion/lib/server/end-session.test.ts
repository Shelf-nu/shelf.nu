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
  const state = {
    stored: true,
    scopes: [] as string[],
    writeBacks: 0,
    deletes: 0,
  };
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
      getSession: async () => {
        // A refresh that was running when the session was deleted writes it
        // back once, the first time the lock is taken after the delete.
        if (state.writeBacks > 0) {
          state.writeBacks -= 1;
          state.stored = true;
        }
        return { data: { session: state.stored ? { user: "u" } : null } };
      },
    },
  };
  const removeStored = async () => {
    state.deletes += 1;
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

  it("deletes again when a running refresh writes the session back", async () => {
    const { client, state, removeStored } = stubClient("error", "error");
    state.writeBacks = 1;

    assert.equal(await endSessionOnDevice(client, removeStored), "forced");
    assert.equal(state.deletes, 2);
    assert.equal(state.stored, false);
  });

  it("stops background refresh before a forced delete", async () => {
    const { client, state, removeStored } = stubClient("error", "error");
    const order: string[] = [];
    client.auth.stopAutoRefresh = async () => {
      order.push(`stop:stored=${state.stored}`);
    };

    await endSessionOnDevice(client, async () => {
      order.push("delete");
      await removeStored();
    });

    assert.deepEqual(order.slice(0, 2), ["stop:stored=true", "delete"]);
  });

  it("does not stop background refresh when a sign-out succeeded", async () => {
    const { client, removeStored } = stubClient("error", "ok");
    let stopped = false;
    client.auth.stopAutoRefresh = async () => {
      stopped = true;
    };

    await endSessionOnDevice(client, removeStored);

    assert.equal(stopped, false);
  });

  it("never rejects, and reports incomplete when every delete fails", async () => {
    const { client } = stubClient("throw", "throw");
    let deletes = 0;

    const outcome = await endSessionOnDevice(client, async () => {
      deletes += 1;
      throw new Error("keychain");
    });

    assert.equal(outcome, "incomplete");
    assert.equal(deletes, 3);
  });

  it("runs the after-session-end tasks on every outcome", async () => {
    let runs = 0;
    const unregisterFailing = onAfterSessionEnd(() => {
      throw new Error("cleanup");
    });
    const unregister = onAfterSessionEnd(() => {
      runs += 1;
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
