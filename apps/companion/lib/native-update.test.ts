/**
 * Tests for the native in-app update rules.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native or Expo.
 *
 * @see ./native-update.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isBannerFallbackActive,
  isNewerVersionAdvertised,
  settlesLaunch,
  shouldAttemptNativeUpdate,
  shouldPresentStoreSheet,
} from "./native-update";

// ── isNewerVersionAdvertised ─────────────────────────────

test("a newer advertised version counts, the same or an older one does not", () => {
  const advertised = (appVersion: string, latestVersion: string | null) =>
    isNewerVersionAdvertised({ appVersion, latestVersion });
  assert.equal(advertised("1.6.0", "1.7.0"), true);
  assert.equal(advertised("1.9.0", "1.10.0"), true);
  assert.equal(advertised("1.7.0", "1.7.0"), false);
  assert.equal(advertised("1.8.0", "1.7.0"), false);
  assert.equal(advertised("1.6.0", null), false);
  // Unreadable versions on either side never prompt.
  assert.equal(advertised("", "1.7.0"), false);
  assert.equal(advertised("1.6.0", "latest"), false);
});

// ── shouldAttemptNativeUpdate ────────────────────────────

const attempt = (
  overrides: Partial<Parameters<typeof shouldAttemptNativeUpdate>[0]> = {}
) =>
  shouldAttemptNativeUpdate({
    platform: "android",
    appVersion: "1.6.0",
    latestVersion: "1.7.0",
    settledThisLaunch: false,
    iosShownStoreVersion: null,
    ...overrides,
  });

test("attempts when the server advertises a newer version", () => {
  assert.equal(attempt(), true);
  assert.equal(attempt({ platform: "ios" }), true);
});

test("does not attempt without a newer advertised version", () => {
  assert.equal(attempt({ latestVersion: null }), false);
  assert.equal(attempt({ latestVersion: "1.6.0" }), false);
  assert.equal(attempt({ appVersion: "" }), false);
});

test("attempts at most once per launch once an attempt has settled", () => {
  assert.equal(attempt({ settledThisLaunch: true }), false);
  assert.equal(attempt({ platform: "ios", settledThisLaunch: true }), false);
});

test("iOS skips a version the store sheet was already shown for", () => {
  assert.equal(
    attempt({ platform: "ios", iosShownStoreVersion: "1.7.0" }),
    false
  );
  // A sheet shown for a newer version covers an older advertised one.
  assert.equal(
    attempt({ platform: "ios", iosShownStoreVersion: "1.8.0" }),
    false
  );
});

test("iOS prompts again when a newer version is advertised", () => {
  assert.equal(
    attempt({
      platform: "ios",
      latestVersion: "1.8.0",
      iosShownStoreVersion: "1.7.0",
    }),
    true
  );
});

test("an unreadable remembered iOS version does not suppress the prompt", () => {
  assert.equal(
    attempt({ platform: "ios", iosShownStoreVersion: "garbage" }),
    true
  );
});

test("Android ignores the iOS memory and relies on once per launch", () => {
  assert.equal(attempt({ iosShownStoreVersion: "1.7.0" }), true);
});

// ── shouldPresentStoreSheet ──────────────────────────────

const present = (
  storeUpdateAvailable: boolean,
  storeVersion: string | null,
  shownStoreVersion: string | null = null
) =>
  shouldPresentStoreSheet({
    storeUpdateAvailable,
    storeVersion,
    shownStoreVersion,
  });

test("presents the sheet for a store version not shown yet", () => {
  assert.equal(present(true, "1.7.0"), true);
  assert.equal(present(true, "1.8.0", "1.7.0"), true);
});

test("does not present when the store has no newer build", () => {
  // The server may advertise a version Apple has not released yet.
  assert.equal(present(false, "1.6.0"), false);
  assert.equal(present(true, null), false);
});

test("does not present a store version the sheet was already shown for", () => {
  assert.equal(present(true, "1.7.0", "1.7.0"), false);
  assert.equal(present(true, "1.7.0", "1.8.0"), false);
});

// ── settlesLaunch / isBannerFallbackActive ───────────────

test("only a store without an update leaves the launch open to a re-check", () => {
  assert.equal(settlesLaunch("started"), true);
  assert.equal(settlesLaunch("unavailable"), true);
  assert.equal(settlesLaunch("no-store-update"), false);
});

test("the banner is a fallback only when the native flow is unavailable", () => {
  assert.equal(isBannerFallbackActive("unavailable"), true);
  assert.equal(isBannerFallbackActive("started"), false);
  assert.equal(isBannerFallbackActive("no-store-update"), false);
  // Pending: hidden, so the banner never flashes before a native sheet.
  assert.equal(isBannerFallbackActive(null), false);
});
