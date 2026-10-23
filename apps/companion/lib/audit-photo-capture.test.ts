/**
 * Tests for the audit photo capture time.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract: a camera photo carries `capturedAt` to the server, a library
 * photo never does.
 *
 * @see ./audit-photo-capture.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { auditImageUploadPath, pickedPhoto } from "./audit-photo-capture";

const NOW = new Date("2026-10-01T21:02:00.000Z");
const file = { uri: "file:///photo.jpg", mimeType: "image/jpeg" };

const ids = {
  orgId: "org-1",
  auditSessionId: "audit-1",
  auditAssetId: "audit-asset-1",
};

test("a camera photo is sent with the moment it was taken", () => {
  const photo = pickedPhoto(file, "camera", NOW);
  assert.equal(photo.capturedAt, "2026-10-01T21:02:00.000Z");

  const url = new URL(
    auditImageUploadPath({ ...ids, capturedAt: photo.capturedAt }),
    "https://app.test"
  );
  assert.equal(url.pathname, "/api/mobile/audits/image");
  assert.equal(url.searchParams.get("capturedAt"), "2026-10-01T21:02:00.000Z");
  assert.equal(url.searchParams.get("auditAssetId"), "audit-asset-1");
});

test("a library photo is sent without a capture time", () => {
  const photo = pickedPhoto(file, "library", NOW);
  assert.equal(photo.capturedAt, null);

  const url = new URL(
    auditImageUploadPath({ ...ids, capturedAt: photo.capturedAt }),
    "https://app.test"
  );
  assert.equal(url.searchParams.has("capturedAt"), false);
  assert.equal(url.searchParams.get("orgId"), "org-1");
  assert.equal(url.searchParams.get("auditSessionId"), "audit-1");
});

test("the picked photo keeps the file the picker returned", () => {
  assert.deepEqual(pickedPhoto(file, "library", NOW), {
    uri: "file:///photo.jpg",
    mimeType: "image/jpeg",
    capturedAt: null,
  });
});
