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

import {
  isPlainRecordId,
  matchResourcePath,
  queryIdsArePlain,
  nativeRouteForLink,
  splitLinkUrl,
} from "./resource-path";

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

test("a delivered link maps to its native screen, keeping the query", () => {
  const cases: [string, string][] = [
    ["https://app.shelf.nu/assets/as_1/overview", "/assets/as_1"],
    ["https://app.shelf.nu/assets", "/assets"],
    ["shelf://assets/new?qrId=qr_1", "/assets/new?qrId=qr_1"],
    ["https://app.shelf.nu/kits/kt_1", "/assets/kits/kt_1"],
    ["shelf://assets/kits/kt_1", "/assets/kits/kt_1"],
    ["https://app.shelf.nu/kits", "/assets/kits"],
    [
      "https://app.shelf.nu/bookings/bk_1?orgId=org_b",
      "/bookings/bk_1?orgId=org_b",
    ],
    ["https://app.shelf.nu/bookings", "/bookings"],
    ["https://app.shelf.nu/audits/au_1/overview", "/audits/au_1"],
    ["https://app.shelf.nu/audits", "/audits"],
    ["https://app.shelf.nu/qr/qr_1", "/"],
    ["shelf://scan", "/scanner"],
    ["shelf://scanner", "/scanner"],
    ["https://app.shelf.nu", "/"],
  ];
  for (const [url, route] of cases) {
    assert.equal(nativeRouteForLink(url), route, url);
  }
});

test("a link outside the allowlist is returned unchanged", () => {
  for (const url of [
    "exp+shelf://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081",
    "https://app.shelf.nu/locations/lc_1",
  ]) {
    assert.equal(nativeRouteForLink(url), url);
  }
});

test("an id that is not a plain record id matches nothing", () => {
  for (const id of [
    "as_1%3ForgId%3Dother",
    "as_1%2Fbookings",
    "as_1%23frag",
    "as_1%26orgId%3Dother",
    "..",
    "as 1",
    "a".repeat(129),
  ]) {
    assert.equal(matchResourcePath(["assets", id]), null, id);
    assert.equal(matchResourcePath(["assets", "kits", id]), null, id);
    assert.equal(matchResourcePath(["bookings", id]), null, id);
    assert.equal(matchResourcePath(["audits", id]), null, id);
    assert.equal(matchResourcePath(["qr", id]), null, id);
  }
  assert.equal(isPlainRecordId("clx9abc_DEF-12"), true);
  assert.equal(isPlainRecordId("SAM-0001"), true);
});

test("a resource link with a refused id lands on the start screen", () => {
  for (const url of [
    "shelf://assets/as_1%3ForgId%3Dother",
    "https://app.shelf.nu/bookings/bk_1%2Fmodel-requests",
    "shelf://audits/..",
    "https://app.shelf.nu/qr/qr_1%26x",
  ]) {
    assert.equal(nativeRouteForLink(url), "/", url);
  }
});

test("the scanner ignores its id, so any id still opens it", () => {
  assert.deepEqual(matchResourcePath(["scanner", "v1.2"]), {
    resource: "scanner",
    id: null,
  });
  assert.equal(nativeRouteForLink("https://app.shelf.nu/scan/a.b"), "/scanner");
});

test("an id-named query value must be a plain record id too", () => {
  assert.equal(queryIdsArePlain("qrId=qr_1&tab=assets"), true);
  assert.equal(queryIdsArePlain("note=a%26b"), true);
  assert.equal(queryIdsArePlain("qrId=qr_1%26orgId%3Dother"), false);
  assert.equal(queryIdsArePlain("auditId=..%2Fx"), false);
  assert.equal(
    nativeRouteForLink("shelf://assets/new?qrId=qr_1"),
    "/assets/new?qrId=qr_1"
  );
  assert.equal(
    nativeRouteForLink("https://app.shelf.nu/audits/scan?auditId=a%2Fb"),
    "/"
  );
});
