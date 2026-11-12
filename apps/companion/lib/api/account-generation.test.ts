/**
 * Tests for the app's account-change counter: what moves it, what does not,
 * and its wiring to auth events, session ends and server switches.
 *
 * @see ./account-generation.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAccountGeneration } from "./account-generation";

/** A fake app: one auth listener per client, plus the lifecycle hooks. */
function fakeApp() {
  const listeners: Array<(userId: string | null) => void> = [];
  let unsubscribed = 0;
  const sessionEndTasks: Array<() => void> = [];
  const serverChangeTasks: Array<() => void> = [];
  /** The live client; a real switch replaces it. */
  let client = {};
  const account = createAccountGeneration({
    subscribeAuth: (listener) => {
      listeners.push(listener);
      return () => {
        unsubscribed += 1;
      };
    },
    onSessionEnd: (task) => sessionEndTasks.push(task),
    onServerChange: (task) => serverChangeTasks.push(task),
    currentClient: () => client,
  });
  return {
    account,
    /** Emits an auth event on the live (latest) client. */
    emit: (userId: string | null) => listeners[listeners.length - 1](userId),
    endSession: () => sessionEndTasks.forEach((task) => task()),
    switchServer: () => {
      client = {};
      serverChangeTasks.forEach((task) => task());
    },
    /** A server change notice that keeps the client (a rename). */
    renameServer: () => serverChangeTasks.forEach((task) => task()),
    get listenerCount() {
      return listeners.length;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

describe("createAccountGeneration", () => {
  it("keeps the generation for the first event and a token refresh", () => {
    const app = fakeApp();
    app.emit("user_a");
    app.emit("user_a");

    assert.equal(app.account.current(), 0);
  });

  it("moves on sign-out and on another user, and tells listeners", () => {
    const app = fakeApp();
    let changes = 0;
    app.account.onChange(() => {
      changes += 1;
    });
    app.emit("user_a");

    app.emit(null);
    app.emit("user_b");

    assert.equal(app.account.current(), 2);
    assert.equal(changes, 2);
  });

  it("moves when a session ends without an auth event", () => {
    const app = fakeApp();
    app.emit("user_a");

    app.endSession();

    assert.equal(app.account.current(), 1);
  });

  it("moves once on a server switch and re-attaches to the new client", () => {
    const app = fakeApp();
    app.emit("user_a");

    app.switchServer();
    app.emit("user_b"); // the new client's first event

    assert.equal(app.account.current(), 1);
    assert.equal(app.listenerCount, 2);
    assert.equal(app.unsubscribed, 1);
  });

  it("an unregistered listener is no longer called", () => {
    const app = fakeApp();
    let changes = 0;
    const unregister = app.account.onChange(() => {
      changes += 1;
    });
    unregister();

    app.endSession();

    assert.equal(changes, 0);
  });

  it("one failing listener does not stop the others", () => {
    const app = fakeApp();
    let changes = 0;
    app.account.onChange(() => {
      throw new Error("listener");
    });
    app.account.onChange(() => {
      changes += 1;
    });

    app.endSession();

    assert.equal(changes, 1);
  });

  it("ignores a server change notice that keeps the same client", () => {
    const app = fakeApp();
    app.emit("user_a");

    app.renameServer();

    assert.equal(app.account.current(), 0);
    assert.equal(app.listenerCount, 1);
    assert.equal(app.unsubscribed, 0);
  });
});
