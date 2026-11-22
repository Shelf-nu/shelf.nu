/**
 * Tests for the account-scoped response cache: a different account, a
 * session end or a server switch never lets the previous account's responses
 * through.
 *
 * @see ./account-cache.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAccountCachedFetch,
  SESSION_CHANGED_ERROR,
} from "./account-cache";
import { createAccountGeneration } from "./account-generation";

const TTL = 60_000;
const ROSTER_PATH = "/api/mobile/team-members?orgId=org_1&page=1&perPage=50";

/** A fake app: account counter wiring plus a fetch answered by hand. */
function harness() {
  const listeners: Array<(userId: string | null) => void> = [];
  const sessionEndTasks: Array<() => void> = [];
  const serverChangeTasks: Array<() => void> = [];
  /** The live client; a real switch replaces it. */
  let client = {};
  const account = createAccountGeneration({
    subscribeAuth: (listener) => {
      listeners.push(listener);
      return () => {};
    },
    onSessionEnd: (task) => sessionEndTasks.push(task),
    onServerChange: (task) => serverChangeTasks.push(task),
    currentClient: () => client,
  });
  const pending: Array<(data: unknown) => void> = [];
  let fetches = 0;
  let clock = 0;
  const cached = createAccountCachedFetch({
    account,
    fetch: <T>() => {
      fetches += 1;
      return new Promise<{ data: T | null; error: string | null }>((resolve) =>
        pending.push((data) => resolve({ data: data as T, error: null }))
      );
    },
    now: () => clock,
  });
  return {
    cached,
    emit: (userId: string | null) => listeners[listeners.length - 1](userId),
    endSession: () => sessionEndTasks.forEach((task) => task()),
    switchServer: () => {
      client = {};
      serverChangeTasks.forEach((task) => task());
    },
    /** A server change notice that keeps the client (a rename). */
    renameServer: () => serverChangeTasks.forEach((task) => task()),
    answer: (data: unknown) => pending.shift()!(data),
    advance: (ms: number) => {
      clock += ms;
    },
    get fetches() {
      return fetches;
    },
  };
}

/** Fetches a path and answers it with `data` at once. */
async function load(app: ReturnType<typeof harness>, data: unknown) {
  const request = app.cached.cachedFetch(ROSTER_PATH, TTL);
  app.answer(data);
  return request;
}

describe("createAccountCachedFetch", () => {
  it("serves a fresh response to the same account, across a token refresh", async () => {
    const app = harness();
    app.emit("user_a");
    await load(app, ["roster"]);

    app.emit("user_a"); // refresh
    assert.deepEqual((await app.cached.cachedFetch(ROSTER_PATH, TTL)).data, [
      "roster",
    ]);
    assert.equal(app.fetches, 1);

    app.advance(TTL);
    const stale = app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 2);
    app.answer(["fresh"]);
    await stale;
  });

  it("a session end empties the cache", async () => {
    const app = harness();
    app.emit("user_a");
    await load(app, ["roster"]);

    app.endSession();
    const second = app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 2);
    app.answer(["fresh"]);
    assert.deepEqual((await second).data, ["fresh"]);
  });

  it("another user signing in empties the cache", async () => {
    const app = harness();
    app.emit("user_a");
    await load(app, ["full roster"]);

    app.emit(null);
    app.emit("user_b");
    const next = app.cached.cachedFetch(ROSTER_PATH, TTL);

    assert.equal(app.fetches, 2);
    app.answer(["own row"]);
    assert.deepEqual((await next).data, ["own row"]);
  });

  it("a response that arrives after a user change is neither stored nor returned", async () => {
    const app = harness();
    app.emit("user_a");
    const late = app.cached.cachedFetch(ROSTER_PATH, TTL);

    app.emit("user_b");
    app.answer(["user a's roster"]);

    assert.deepEqual(await late, { data: null, error: SESSION_CHANGED_ERROR });
    const next = app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 2);
    app.answer(["user b's roster"]);
    assert.deepEqual((await next).data, ["user b's roster"]);
  });

  it("a server switch empties the cache", async () => {
    const app = harness();
    app.emit("user_a");
    await load(app, ["old server roster"]);

    app.switchServer();
    const second = app.cached.cachedFetch(ROSTER_PATH, TTL);

    assert.equal(app.fetches, 2);
    app.answer(["new server roster"]);
    assert.deepEqual((await second).data, ["new server roster"]);
  });

  it("a response still in flight across a server switch is dropped", async () => {
    const app = harness();
    app.emit("user_a");
    const inFlight = app.cached.cachedFetch(ROSTER_PATH, TTL);

    app.switchServer();
    app.answer(["old server roster"]);

    assert.deepEqual(await inFlight, {
      data: null,
      error: SESSION_CHANGED_ERROR,
    });
  });

  it("a fetch started right after a server switch resolves with data", async () => {
    const app = harness();
    app.emit("user_a");

    app.switchServer();
    const request = app.cached.cachedFetch(ROSTER_PATH, TTL);
    app.emit("user_b"); // the new client's first auth event
    app.answer(["new server roster"]);

    assert.deepEqual(await request, {
      data: ["new server roster"],
      error: null,
    });
  });

  it("invalidate removes by prefix", async () => {
    const app = harness();
    app.emit("user_a");
    await load(app, ["roster"]);

    app.cached.invalidate("/api/mobile/locations");
    await app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 1);

    app.cached.invalidate("/api/mobile/team-members");
    const again = app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 2);
    app.answer(["roster"]);
    await again;
  });

  it("a rename of the server keeps the cache and in-flight responses", async () => {
    const app = harness();
    app.emit("user_a");
    const inFlight = app.cached.cachedFetch(ROSTER_PATH, TTL);

    app.renameServer();
    app.answer(["roster"]);

    assert.deepEqual(await inFlight, { data: ["roster"], error: null });
    await app.cached.cachedFetch(ROSTER_PATH, TTL);
    assert.equal(app.fetches, 1);
  });
});
