/**
 * Tests for how a stored link opens: Shelf's own web app in the in-app
 * browser, every other website through the OS with Shelf's ref attached.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./open-link.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLinkOpening } from "./open-link";

const CLOUD = "https://app.shelf.nu";
const SELF_HOSTED = "https://assets.example.org";

test("a claimed app.shelf.nu link stays in the in-app browser, untouched", () => {
  // Linking.openURL of a claimed path would be intercepted and reopen the app.
  assert.deepEqual(
    resolveLinkOpening(
      "https://app.shelf.nu/assets/as_1/overview",
      SELF_HOSTED
    ),
    {
      opener: "shelf-browser",
      url: "https://app.shelf.nu/assets/as_1/overview",
    }
  );
});

test("a claimed host typed in capitals still stays in-app", () => {
  assert.equal(
    resolveLinkOpening(
      "https://App.Shelf.NU/qr/qr_1",
      "https://Assets.example.org"
    )?.opener,
    "shelf-browser"
  );
  assert.equal(
    resolveLinkOpening("https://ASSETS.example.org/kits/kt_1", SELF_HOSTED)
      ?.opener,
    "shelf-browser"
  );
});

test("a link to the connected self-hosted server also stays in-app", () => {
  assert.deepEqual(
    resolveLinkOpening("https://assets.example.org/bookings/bk_1", SELF_HOSTED),
    { opener: "shelf-browser", url: "https://assets.example.org/bookings/bk_1" }
  );
});

test("a SharePoint share link goes to the OS with the companion ref", () => {
  assert.deepEqual(
    resolveLinkOpening(
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1",
      CLOUD
    ),
    {
      opener: "system",
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
      opener: "system",
      url: "https://www.dropbox.com/scl/fi/abc/Cal%20cert.pdf?rlkey=a%2Fb&dl=0&ref=shelf-companion#page=2",
    }
  );
});

test("a link without a query gets the ref as its only parameter", () => {
  assert.deepEqual(
    resolveLinkOpening("https://usa.canon.com/manual.pdf", CLOUD),
    {
      opener: "system",
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
      opener: "system",
      url: "https://usa.canon.com/manual.pdf?ref=shelf-companion",
    }
  );
});

test("the same host on another port is not the connected server", () => {
  assert.equal(
    resolveLinkOpening(
      "http://192.168.1.5:8080/manual.pdf",
      "http://192.168.1.5:3000"
    )?.opener,
    "system"
  );
});

test("anything that is not an http(s) URL opens nothing", () => {
  assert.equal(resolveLinkOpening("javascript:alert(1)", CLOUD), null);
  assert.equal(resolveLinkOpening("mailto:lab@example.com", CLOUD), null);
  assert.equal(resolveLinkOpening("see the binder", CLOUD), null);
});
