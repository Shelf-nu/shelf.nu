/**
 * Tests for the "new version available" banner rules.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native or Expo.
 *
 * @see ./update-banner.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compareAppVersions } from "./server/contract";
import {
  laterDismissal,
  parseLatestCompanionVersion,
  shouldShowUpdateBanner,
} from "./update-banner";

// ── compareAppVersions ───────────────────────────────────

test("compareAppVersions orders by number, not by string", () => {
  // "1.10.0" sorts before "1.9.0" as a string.
  assert.ok(compareAppVersions("1.10.0", "1.9.0")! > 0);
  assert.ok(compareAppVersions("1.5.0", "1.6.0")! < 0);
  assert.ok(compareAppVersions("2.0.0", "1.99.99")! > 0);
});

test("compareAppVersions treats a missing segment as zero", () => {
  assert.equal(compareAppVersions("1.6", "1.6.0"), 0);
  assert.equal(compareAppVersions("1.6.0", "1.6.0"), 0);
});

test("compareAppVersions ignores pre-release and build suffixes", () => {
  assert.equal(compareAppVersions("1.6.0-beta.1", "1.6.0"), 0);
  assert.equal(compareAppVersions("1.6.0+42", "1.6.0"), 0);
});

test("compareAppVersions returns null when either side is not a version", () => {
  assert.equal(compareAppVersions("", "1.6.0"), null);
  assert.equal(compareAppVersions("1.5.0", "latest"), null);
  assert.equal(compareAppVersions("v1.6.0", "1.6.0"), null);
});

// ── parseLatestCompanionVersion ──────────────────────────

test("parseLatestCompanionVersion reads and trims the field", () => {
  assert.equal(
    parseLatestCompanionVersion({ latestCompanionVersion: " 1.6.0 " }),
    "1.6.0"
  );
});

test("parseLatestCompanionVersion returns null for anything else", () => {
  for (const body of [
    null,
    undefined,
    "1.6.0",
    [],
    {},
    { latestCompanionVersion: null },
    { latestCompanionVersion: "" },
    { latestCompanionVersion: "   " },
    { latestCompanionVersion: 160 },
  ]) {
    assert.equal(parseLatestCompanionVersion(body), null, JSON.stringify(body));
  }
});

// ── shouldShowUpdateBanner ───────────────────────────────

const show = (
  appVersion: string,
  latestVersion: string | null,
  dismissedVersion: string | null = null
) => shouldShowUpdateBanner({ appVersion, latestVersion, dismissedVersion });

test("shows when this build is older than the advertised version", () => {
  assert.equal(show("1.5.0", "1.6.0"), true);
  assert.equal(show("1.9.0", "1.10.0"), true);
});

test("hides when this build is the advertised version or newer", () => {
  assert.equal(show("1.6.0", "1.6.0"), false);
  assert.equal(show("1.7.0", "1.6.0"), false);
});

test("hides when the server advertises no version", () => {
  // Unset env var on the server = null on the wire = no banner.
  assert.equal(show("1.5.0", null), false);
  assert.equal(show("1.5.0", ""), false);
});

test("hides when either version cannot be read", () => {
  // `getAppVersion()` returns "" when the build's version is unknown.
  assert.equal(show("", "1.6.0"), false);
  assert.equal(show("1.5.0", "latest"), false);
});

test("stays hidden once the advertised version was dismissed", () => {
  assert.equal(show("1.5.0", "1.6.0", "1.6.0"), false);
  assert.equal(show("1.5.0", "1.6", "1.6.0"), false);
});

test("comes back when a newer version is advertised after a dismissal", () => {
  assert.equal(show("1.5.0", "1.7.0", "1.6.0"), true);
});

test("a dismissal of a newer version also covers an older advertised one", () => {
  // A server rolled back from 1.7.0 to 1.6.0 should not nag again.
  assert.equal(show("1.5.0", "1.6.0", "1.7.0"), false);
});

test("an unreadable stored dismissal does not hide the banner", () => {
  assert.equal(show("1.5.0", "1.6.0", "garbage"), true);
});

// ── laterDismissal ───────────────────────────────────────

test("laterDismissal keeps a dismissal made while a check was in flight", () => {
  // The check read nothing from storage; the user tapped X on 1.6.0 meanwhile.
  assert.equal(laterDismissal(null, "1.6.0"), "1.6.0");
  assert.equal(laterDismissal("1.6.0", null), "1.6.0");
  // The check read an older stored dismissal.
  assert.equal(laterDismissal("1.5.5", "1.6.0"), "1.6.0");
  assert.equal(laterDismissal("1.6.0", "1.5.5"), "1.6.0");
});

test("laterDismissal prefers the readable value over an unreadable one", () => {
  assert.equal(laterDismissal("garbage", "1.6.0"), "1.6.0");
  assert.equal(laterDismissal("1.6.0", "garbage"), "1.6.0");
  assert.equal(laterDismissal(null, null), null);
});
