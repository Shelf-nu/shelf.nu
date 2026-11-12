/**
 * Tests for the export gate and the Metro setting it guards.
 *
 * The app needs React Native's fetch as the global fetch. metro.config.js
 * turns Expo's fetch off for every bundle, and check-bundle-env.mjs refuses an
 * exported bundle that still carries it.
 *
 * @see {@link file://./check-bundle-env.mjs}
 * @see {@link file://../metro.config.js}
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { refsIn, usesExpoFetch } from "./check-bundle-env.mjs";

const require = createRequire(import.meta.url);

describe("usesExpoFetch", () => {
  it("flags a bundle that carries Expo's native fetch module", () => {
    assert.equal(
      usesExpoFetch("\u0000requireNativeModule\u0000ExpoFetchModule\u0000"),
      true
    );
  });

  it("passes a bundle that uses React Native's fetch", () => {
    assert.equal(
      usesExpoFetch("\u0000Network request failed\u0000expo.builtin\u0000"),
      false
    );
  });
});

describe("refsIn", () => {
  it("still reads the Supabase ref out of packed Hermes strings", () => {
    assert.deepEqual(refsIn("xhttps://abcdefghijkl.supabase.coNext string"), [
      "abcdefghijkl",
    ]);
  });
});

describe("metro.config.js", () => {
  it("builds every bundle with React Native's fetch", () => {
    delete process.env.EXPO_PUBLIC_USE_RN_FETCH;
    require("../metro.config.js");
    assert.equal(process.env.EXPO_PUBLIC_USE_RN_FETCH, "1");
  });

  it("names the fetch switch in Metro's cache version", () => {
    const config = require("../metro.config.js");
    assert.match(String(config.cacheVersion), /rn-fetch:1/);
  });
});
