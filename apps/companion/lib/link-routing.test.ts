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
  type LinkRead,
} from "./link-routing";

/**
 * One row per link kind the OS can deliver: what `parseDeepLink` reads, and what the
 * hook opens for it. `null` means the link names no screen of the app, so
 * the router keeps it.
 */
const LINKS: Array<{
  url: string;
  link: LinkRead;
  hookOpens: LinkAction | null;
}> = [
  {
    url: "https://app.shelf.nu/assets/as_1/overview",
    link: { type: "asset" },
    hookOpens: { kind: "route", route: "/assets/as_1" },
  },
  {
    url: "https://app.shelf.nu/assets/kits/kt_1",
    link: { type: "kit" },
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "https://app.shelf.nu/kits/kt_1",
    link: { type: "kit" },
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "https://app.shelf.nu/bookings/bk_1",
    link: { type: "booking" },
    hookOpens: { kind: "route", route: "/bookings/bk_1" },
  },
  {
    url: "https://app.shelf.nu/audits/au_1",
    link: { type: "audit" },
    hookOpens: { kind: "route", route: "/audits/au_1" },
  },
  {
    url: "https://app.shelf.nu/qr/qr_1",
    link: { type: "qr", id: "qr_1", origin: "https://app.shelf.nu" },
    hookOpens: { kind: "qr", id: "qr_1", origin: "https://app.shelf.nu" },
  },
  {
    url: "shelf://assets/as_1",
    link: { type: "asset" },
    hookOpens: { kind: "route", route: "/assets/as_1" },
  },
  {
    url: "shelf://kits/kt_1",
    link: { type: "kit" },
    hookOpens: { kind: "route", route: "/assets/kits/kt_1" },
  },
  {
    url: "shelf://bookings/bk_1",
    link: { type: "booking" },
    hookOpens: { kind: "route", route: "/bookings/bk_1" },
  },
  {
    url: "shelf://audits/au_1",
    link: { type: "audit" },
    hookOpens: { kind: "route", route: "/audits/au_1" },
  },
  {
    url: "shelf://scanner",
    link: { type: "scanner" },
    hookOpens: { kind: "route", route: "/scanner" },
  },
  {
    url: "shelf://qr/qr_1",
    link: { type: "qr", id: "qr_1" },
    hookOpens: { kind: "qr", id: "qr_1", origin: undefined },
  },
  // A link to a list names no id, so `parseDeepLink` reads it as unknown; the
  // hook still opens the list the route names.
  {
    url: "shelf://bookings",
    link: { type: "unknown" },
    hookOpens: { kind: "route", route: "/bookings" },
  },
  {
    url: "https://app.shelf.nu/assets/",
    link: { type: "unknown" },
    hookOpens: { kind: "route", route: "/assets" },
  },
  // A bare path, as `splitLinkUrl` also reads it, is the hook's too.
  {
    url: "/assets/as_1",
    link: { type: "unknown" },
    hookOpens: { kind: "route", route: "/assets/as_1" },
  },
  {
    url: "/bookings/bk_1?tab=assets",
    link: { type: "unknown" },
    hookOpens: { kind: "route", route: "/bookings/bk_1?tab=assets" },
  },
  {
    url: "https://app.shelf.nu/assets/kits",
    link: { type: "unknown" },
    hookOpens: { kind: "route", route: "/assets/kits" },
  },
];

for (const { url, link, hookOpens } of LINKS) {
  test(`the hook opens ${url}, anchored in its tab`, () => {
    assert.deepEqual(linkAction(url, link), hookOpens);
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
    linkAction("https://app.shelf.nu/assets/new?qrId=qr_1", { type: "asset" }),
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
    assert.deepEqual(linkAction(url, { type: "unknown" }), { kind: "none" });
  }
});

test("an unknown path whose query carries a refused id is kept from the router and opens nothing", () => {
  const url = "shelf://reports?orgId=bad%20id";
  assert.equal(systemPathFor({ path: url, initial: true }), "/");
  assert.equal(systemPathFor({ path: url, initial: false }), null);
  assert.deepEqual(linkAction(url, { type: "unknown" }), { kind: "none" });
});

test("a link with a refused id opens nothing: the start screen at launch, no change later", () => {
  const url = "shelf://assets/bad%20id";
  assert.equal(systemPathFor({ path: url, initial: true }), "/");
  assert.equal(systemPathFor({ path: url, initial: false }), null);
  assert.deepEqual(linkAction(url, { type: "unknown" }), { kind: "none" });
});
