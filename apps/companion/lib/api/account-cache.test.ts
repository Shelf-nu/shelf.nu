/**
 * Tests for the account-scoped response cache: a different account never
 * reads the previous account's responses.
 *
 * @see ./account-cache.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAccountScopedCache } from "./account-cache";

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
});
