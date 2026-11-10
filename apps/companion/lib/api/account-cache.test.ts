/**
 * Tests for the account-scoped response cache: a different account never
 * reads the previous account's responses.
 *
 * @see ./account-cache.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAccountCachedFetch,
  createAccountScopedCache,
  SESSION_CHANGED_ERROR,
} from "./account-cache";

const TTL = 60_000;
const ROSTER_PATH = "/api/mobile/team-members?orgId=org_1&page=1&perPage=50";

describe("createAccountScopedCache", () => {
  it("serves a fresh response to the same account", () => {
    const cache = createAccountScopedCache();
    cache.observeUser("user_a");
    cache.set(ROSTER_PATH, ["roster"], cache.generation(), 0);

    assert.deepEqual(cache.get(ROSTER_PATH, TTL, 1_000), ["roster"]);
    assert.equal(cache.get(ROSTER_PATH, TTL, TTL), undefined);
  });

  it("keeps entries across a token refresh for the same user", () => {
    const cache = createAccountScopedCache();
    cache.observeUser("user_a");
    cache.set(ROSTER_PATH, ["roster"], cache.generation(), 0);

    cache.observeUser("user_a");

    assert.deepEqual(cache.get(ROSTER_PATH, TTL, 1), ["roster"]);
  });

  it("empties on sign-out and when another user signs in", () => {
    const cache = createAccountScopedCache();
    cache.observeUser("user_a");
    cache.set(ROSTER_PATH, ["full roster"], cache.generation(), 0);

    cache.observeUser(null);
    assert.equal(cache.get(ROSTER_PATH, TTL, 1), undefined);

    cache.observeUser("user_b");
    cache.set(ROSTER_PATH, ["own row"], cache.generation(), 0);
    cache.observeUser("user_a");
    assert.equal(cache.get(ROSTER_PATH, TTL, 1), undefined);
  });

  it("drops a response whose request began before the account changed", () => {
    const cache = createAccountScopedCache();
    cache.observeUser("user_a");
    const startedIn = cache.generation();

    cache.observeUser(null);

    assert.equal(cache.set(ROSTER_PATH, ["roster"], startedIn, 0), false);
    assert.equal(cache.get(ROSTER_PATH, TTL, 1), undefined);
  });

  it("resetAccount empties the cache and rejects in-flight writes", () => {
    const cache = createAccountScopedCache();
    cache.set(ROSTER_PATH, ["roster"], cache.generation(), 0);
    const startedIn = cache.generation();

    cache.resetAccount();

    assert.equal(cache.get(ROSTER_PATH, TTL, 1), undefined);
    assert.equal(cache.set(ROSTER_PATH, ["late"], startedIn, 0), false);
  });

  it("invalidate removes by prefix without touching the generation", () => {
    const cache = createAccountScopedCache();
    const generation = cache.generation();
    cache.set("/api/mobile/locations?orgId=org_1", ["loc"], generation, 0);
    cache.set(ROSTER_PATH, ["roster"], generation, 0);

    cache.invalidate("/api/mobile/locations");

    assert.equal(
      cache.get("/api/mobile/locations?orgId=org_1", TTL, 1),
      undefined
    );
    assert.deepEqual(cache.get(ROSTER_PATH, TTL, 1), ["roster"]);
    assert.equal(cache.generation(), generation);
  });

  it("keeps a write that started before the first auth event", () => {
    const cache = createAccountScopedCache();
    const startedIn = cache.generation();

    cache.observeUser("user_a");

    assert.equal(cache.set(ROSTER_PATH, ["roster"], startedIn, 0), true);
  });
});

describe("createAccountCachedFetch", () => {
  /** A fake app: auth listeners per client, session-end and switch hooks. */
  function harness() {
    const listeners: Array<(userId: string | null) => void> = [];
    let unsubscribed = 0;
    const sessionEndTasks: Array<() => void> = [];
    const serverChangeTasks: Array<() => void> = [];
    const pending: Array<{
      path: string;
      resolve: (r: { data: unknown; error: null }) => void;
    }> = [];
    let fetches = 0;

    const cached = createAccountCachedFetch({
      subscribeAuth: (listener) => {
        listeners.push(listener);
        return () => {
          unsubscribed += 1;
        };
      },
      onSessionEnd: (task) => sessionEndTasks.push(task),
      onServerChange: (task) => serverChangeTasks.push(task),
      fetch: <T>(path: string) => {
        fetches += 1;
        return new Promise<{ data: T | null; error: string | null }>(
          (resolve) => pending.push({ path, resolve: resolve as never })
        );
      },
      now: () => 0,
    });

    return {
      cached,
      /** Emits an auth event on the live (latest) client. */
      emit: (userId: string | null) => listeners[listeners.length - 1](userId),
      endSession: () => sessionEndTasks.forEach((t) => t()),
      switchServer: () => serverChangeTasks.forEach((t) => t()),
      answer: (data: unknown) =>
        pending.shift()!.resolve({ data, error: null }),
      get listenerCount() {
        return listeners.length;
      },
      get unsubscribed() {
        return unsubscribed;
      },
      get fetches() {
        return fetches;
      },
    };
  }

  it("a session end empties the cache", async () => {
    const app = harness();
    app.emit("user_a");
    const first = app.cached.cachedFetch(ROSTER_PATH, TTL);
    app.answer(["roster"]);
    await first;

    app.endSession();
    const second = app.cached.cachedFetch(ROSTER_PATH, TTL);
    app.answer(["fresh"]);

    assert.deepEqual((await second).data, ["fresh"]);
    assert.equal(app.fetches, 2);
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

  it("attaches the listener to the new client after a server switch", () => {
    const app = harness();

    app.switchServer();

    assert.equal(app.listenerCount, 2);
    assert.equal(app.unsubscribed, 1);
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
});
