/**
 * Tests for the split between expo-router and the JS deep-link hook: the hook
 * opens every link that names a screen of the app (anchored in its tab), and
 * the router opens none of them.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./link-routing.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  linkAction,
  systemPathFor,
  type LinkAction,
  type LinkKind,
} from "./link-routing";

/**
 * One row per link kind the OS can deliver: the parsed kind, and what the
 * hook opens for it. `null` means the link names no screen of the app, so
 * the router keeps it.
 */
const LINKS: Array<{
  url: string;
  kind: LinkKind;
  hookOpens: LinkAction | null;
}> = [
  {
    url: "https://app.shelf.nu/assets/as_1/overview",
    kind: "asset",
    hookOpens: { kind: "route", route: "/assets/as_1" },
  },
  {
    url: "https://app.shelf.nu/assets/kits/kt_1",
    kind: "kit",
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "https://app.shelf.nu/kits/kt_1",
    kind: "kit",
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "https://app.shelf.nu/bookings/bk_1",
    kind: "booking",
    hookOpens: { kind: "route", route: "/bookings/bk_1" },
  },
  {
    url: "https://app.shelf.nu/audits/au_1",
    kind: "audit",
    hookOpens: { kind: "route", route: "/audits/au_1" },
  },
  {
    url: "https://app.shelf.nu/qr/qr_1",
    kind: "qr",
    hookOpens: { kind: "qr" },
  },
  {
    url: "shelf://assets/as_1",
    kind: "asset",
    hookOpens: { kind: "route", route: "/assets/as_1" },
  },
  {
    url: "shelf://kits/kt_1",
    kind: "kit",
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "shelf://bookings/bk_1",
    kind: "booking",
    hookOpens: { kind: "route", route: "/bookings/bk_1" },
  },
  {
    url: "shelf://audits/au_1",
    kind: "audit",
    hookOpens: { kind: "route", route: "/audits/au_1" },
  },
  {
    url: "shelf://scanner",
    kind: "scanner",
    hookOpens: { kind: "route", route: "/scanner" },
  },
  {
    url: "shelf://qr/qr_1",
    kind: "qr",
    hookOpens: { kind: "qr" },
  },
];

for (const { url, kind, hookOpens } of LINKS) {
  test(`the hook opens ${url}, anchored in its tab`, () => {
    assert.deepEqual(linkAction(url, kind), hookOpens);
  });

  test(`the router starts on the start screen when ${url} launches the app`, () => {
    assert.equal(systemPathFor({ path: url, initial: true }), "/");
  });

  test(`the router ignores ${url} while the app runs`, () => {
    assert.equal(systemPathFor({ path: url, initial: false }), null);
  });
}

test("a link keeps its query, so a new asset keeps the QR it was opened from", () => {
  assert.deepEqual(
    linkAction("https://app.shelf.nu/assets/new?qrId=qr_1", "asset"),
    { kind: "route", route: "/assets/new?qrId=qr_1" }
  );
});

test("a link that names no screen of the app stays with the router", () => {
  for (const url of [
    "shelf://auth-callback?code=abc",
    "https://app.shelf.nu/login",
  ]) {
    for (const initial of [true, false]) {
      assert.equal(systemPathFor({ path: url, initial }), url);
    }
    assert.deepEqual(linkAction(url, "unknown"), { kind: "none" });
  }
});

test("a link with a refused id opens nothing: the start screen at launch, no change later", () => {
  const url = "shelf://assets/bad%20id";
  assert.equal(systemPathFor({ path: url, initial: true }), "/");
  assert.equal(systemPathFor({ path: url, initial: false }), null);
  assert.deepEqual(linkAction(url, "unknown"), { kind: "none" });
});
