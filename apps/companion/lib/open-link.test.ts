/**
 * Tests for where a tapped link goes: a Shelf web link the app has a screen
 * for opens that screen, every other web page opens in the in-app browser
 * (other websites with Shelf's ref attached).
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./open-link.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isExternalLink, resolveLinkOpening } from "./open-link";

const CLOUD = "https://app.shelf.nu";
const SELF_HOSTED = "https://assets.example.org";

test("a Shelf asset link opens the asset screen, deeper paths included", () => {
  for (const url of [
    "https://app.shelf.nu/assets/as_1",
    "https://app.shelf.nu/assets/as_1/overview",
    "https://app.shelf.nu/assets/as_1/activity?orgId=org_1#top",
  ]) {
    assert.deepEqual(
      resolveLinkOpening(url, CLOUD),
      {
        opener: "screen",
        tabRoot: "/(tabs)/assets",
        href: "/(tabs)/assets/as_1",
      },
      url
    );
  }
});

test("kit, booking and audit links open their screens", () => {
  assert.deepEqual(
    resolveLinkOpening("https://app.shelf.nu/kits/kt_1/assets", CLOUD),
    {
      opener: "screen",
      tabRoot: "/(tabs)/assets",
      href: "/(tabs)/assets/kits/kt_1",
    }
  );
  assert.deepEqual(
    resolveLinkOpening("https://app.shelf.nu/bookings/bk_1/overview", CLOUD),
    {
      opener: "screen",
      tabRoot: "/(tabs)/bookings",
      href: "/(tabs)/bookings/bk_1",
    }
  );
  assert.deepEqual(
    resolveLinkOpening("https://app.shelf.nu/audits/au_1", CLOUD),
    {
      opener: "screen",
      tabRoot: "/(tabs)/audits",
      href: "/(tabs)/audits/au_1",
    }
  );
});

test("a list link opens that tab's list", () => {
  assert.deepEqual(resolveLinkOpening("https://app.shelf.nu/bookings", CLOUD), {
    opener: "screen",
    tabRoot: "/(tabs)/bookings",
    href: null,
  });
  assert.deepEqual(resolveLinkOpening("https://app.shelf.nu/kits", CLOUD), {
    opener: "screen",
    tabRoot: "/(tabs)/assets",
    href: "/(tabs)/assets/kits",
  });
});

test("a QR link is resolved in-app against the server it came from", () => {
  assert.deepEqual(
    resolveLinkOpening("https://app.shelf.nu/qr/qr_1", SELF_HOSTED),
    { opener: "qr", qrId: "qr_1", origin: "https://app.shelf.nu" }
  );
});

test("the connected self-hosted server counts as Shelf, port included", () => {
  assert.equal(
    resolveLinkOpening("https://ASSETS.example.org/bookings/bk_1", SELF_HOSTED)
      ?.opener,
    "screen"
  );
  assert.equal(
    resolveLinkOpening(
      "http://192.168.1.5:3000/assets/as_1",
      "http://192.168.1.5:3000"
    )?.opener,
    "screen"
  );
  assert.deepEqual(
    resolveLinkOpening(
      "http://192.168.1.5:8080/assets/as_1",
      "http://192.168.1.5:3000"
    ),
    {
      opener: "browser",
      url: "http://192.168.1.5:8080/assets/as_1?ref=shelf-companion",
    }
  );
});

test("a claimed host typed in capitals is still Shelf", () => {
  assert.equal(
    resolveLinkOpening("https://App.Shelf.NU/qr/qr_1", SELF_HOSTED)?.opener,
    "qr"
  );
});

test("Shelf pages the app has no screen for open untouched in the browser", () => {
  for (const url of [
    "https://app.shelf.nu/locations/loc_1",
    "https://app.shelf.nu/settings/team",
    "https://app.shelf.nu/assets/import",
    "https://app.shelf.nu/assets/new",
    "https://app.shelf.nu/bookings/export",
    "https://app.shelf.nu/kits/new",
    "https://app.shelf.nu/audits/scan",
    "https://app.shelf.nu/qr",
    "https://app.shelf.nu/",
  ]) {
    assert.deepEqual(
      resolveLinkOpening(url, CLOUD),
      { opener: "browser", url },
      url
    );
  }
});

test("another website opens in the browser with the companion ref", () => {
  assert.deepEqual(
    resolveLinkOpening(
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1",
      CLOUD
    ),
    {
      opener: "browser",
      url: "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1&ref=shelf-companion",
    }
  );
});

test("the ref goes before a #fragment and leaves encoded params as stored", () => {
  assert.deepEqual(
    resolveLinkOpening(
      "https://www.dropbox.com/scl/fi/abc/Cal%20cert.pdf?rlkey=a%2Fb&dl=0#page=2",
      CLOUD
    ),
    {
      opener: "browser",
      url: "https://www.dropbox.com/scl/fi/abc/Cal%20cert.pdf?rlkey=a%2Fb&dl=0&ref=shelf-companion#page=2",
    }
  );
});

test("a link without a query gets the ref as its only parameter", () => {
  assert.deepEqual(
    resolveLinkOpening("https://usa.canon.com/manual.pdf", CLOUD),
    {
      opener: "browser",
      url: "https://usa.canon.com/manual.pdf?ref=shelf-companion",
    }
  );
});

test("a link that already carries the companion ref is not tagged twice", () => {
  assert.deepEqual(
    resolveLinkOpening(
      "https://usa.canon.com/manual.pdf?ref=shelf-companion",
      CLOUD
    ),
    {
      opener: "browser",
      url: "https://usa.canon.com/manual.pdf?ref=shelf-companion",
    }
  );
});

test("anything that is not an http(s) URL opens nothing", () => {
  assert.equal(resolveLinkOpening("javascript:alert(1)", CLOUD), null);
  assert.equal(resolveLinkOpening("mailto:lab@example.com", CLOUD), null);
  assert.equal(resolveLinkOpening("see the binder", CLOUD), null);
});

test("only links off Shelf count as external", () => {
  assert.equal(isExternalLink("https://canon.com/r5.pdf", CLOUD), true);
  assert.equal(
    isExternalLink("https://app.shelf.nu/assets/as_1", CLOUD),
    false
  );
  assert.equal(
    isExternalLink("https://assets.example.org/locations/1", SELF_HOSTED),
    false
  );
  assert.equal(isExternalLink("mailto:lab@example.com", CLOUD), false);
});
