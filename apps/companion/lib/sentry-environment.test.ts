/**
 * Tests for which Sentry environment a companion build reports to.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./sentry-environment.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSentryEnvironment } from "./sentry-environment";

test("a simulator or emulator never reports, whatever the build says", () => {
  assert.equal(
    resolveSentryEnvironment({
      isDevice: false,
      configuredEnvironment: "production",
      channel: "production",
    }),
    null
  );
});

test("a phone reports under the environment set for the build", () => {
  assert.equal(
    resolveSentryEnvironment({
      isDevice: true,
      configuredEnvironment: "staging",
      channel: "production",
    }),
    "staging"
  );
});

test("a preview build on a phone reports as preview, not production", () => {
  assert.equal(
    resolveSentryEnvironment({
      isDevice: true,
      configuredEnvironment: undefined,
      channel: "preview",
    }),
    "preview"
  );
});

test("a phone with no environment and no channel reports as production", () => {
  for (const channel of [null, undefined, ""]) {
    assert.equal(
      resolveSentryEnvironment({
        isDevice: true,
        configuredEnvironment: "",
        channel,
      }),
      "production"
    );
  }
});
