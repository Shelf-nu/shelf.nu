/**
 * Tests for the resource path allowlist shared by universal links and push
 * taps.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./resource-path.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { matchResourcePath, splitLinkUrl } from "./resource-path";

test("a detail path names its resource and id, however deep the web path is", () => {
  assert.deepEqual(matchResourcePath(["assets", "as_1"]), {
    resource: "assets",
    id: "as_1",
  });
  assert.deepEqual(matchResourcePath(["assets", "as_1", "overview"]), {
    resource: "assets",
    id: "as_1",
  });
  assert.deepEqual(matchResourcePath(["bookings", "bk_1"]), {
    resource: "bookings",
    id: "bk_1",
  });
  assert.deepEqual(matchResourcePath(["audits", "au_1", "overview"]), {
    resource: "audits",
    id: "au_1",
  });
  assert.deepEqual(matchResourcePath(["qr", "qr_1"]), {
    resource: "qr",
    id: "qr_1",
  });
});

test("a kit is a kit under both its own prefix and the assets prefix", () => {
  assert.deepEqual(matchResourcePath(["kits", "kt_1"]), {
    resource: "kits",
    id: "kt_1",
  });
  assert.deepEqual(matchResourcePath(["assets", "kits", "kt_1"]), {
    resource: "kits",
    id: "kt_1",
  });
  assert.deepEqual(matchResourcePath(["assets", "kits"]), {
    resource: "kits",
    id: null,
  });
});

test("a resource prefix without an id names the list", () => {
  for (const resource of ["assets", "kits", "bookings", "audits"] as const) {
    assert.deepEqual(
      matchResourcePath([resource]),
      { resource, id: null },
      resource
    );
  }
});

test("both scanner spellings name the scanner, with no id", () => {
  assert.deepEqual(matchResourcePath(["scanner"]), {
    resource: "scanner",
    id: null,
  });
  assert.deepEqual(matchResourcePath(["scan", "anything"]), {
    resource: "scanner",
    id: null,
  });
});

test("a path outside the allowlist matches nothing", () => {
  for (const segments of [
    [],
    ["locations", "lc_1"],
    ["login"],
    ["settings", "general"],
    ["--", "expo-development-client"],
  ]) {
    assert.equal(matchResourcePath(segments), null, segments.join("/"));
  }
});

test("a universal link loses its host, a custom-scheme link keeps its first part", () => {
  assert.deepEqual(splitLinkUrl("https://app.shelf.nu/assets/as_1/overview"), {
    segments: ["assets", "as_1", "overview"],
    query: "",
  });
  assert.deepEqual(splitLinkUrl("shelf://assets/as_1"), {
    segments: ["assets", "as_1"],
    query: "",
  });
  assert.deepEqual(splitLinkUrl("/bookings/bk_1"), {
    segments: ["bookings", "bk_1"],
    query: "",
  });
  assert.deepEqual(splitLinkUrl("https://app.shelf.nu"), {
    segments: [],
    query: "",
  });
});

test("the query survives the split and the hash does not", () => {
  assert.deepEqual(
    splitLinkUrl("https://app.shelf.nu/assets/new?qrId=q1#top"),
    {
      segments: ["assets", "new"],
      query: "qrId=q1",
    }
  );
  assert.deepEqual(splitLinkUrl("/bookings/bk_1?orgId=org_b&tab=assets"), {
    segments: ["bookings", "bk_1"],
    query: "orgId=org_b&tab=assets",
  });
});
