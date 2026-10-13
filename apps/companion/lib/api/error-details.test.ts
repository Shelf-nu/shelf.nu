/**
 * Tests for reading the mobile API's error envelope.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./error-details.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { extractErrorDetails } from "./error-details";

test("an archived refusal keeps the ids it names", () => {
  // The shape `findMobileArchivedRefusal` sends from the scan-list routes.
  assert.deepEqual(
    extractErrorDetails({
      error: {
        message:
          "Archived assets are read-only. Reinstate them before making changes.",
        reason: "archived",
        archivedAssetIds: ["asset-1", "asset-2"],
      },
    }),
    {
      message:
        "Archived assets are read-only. Reinstate them before making changes.",
      reason: "archived",
      archivedAssetIds: ["asset-1", "asset-2"],
    }
  );
});

test("an unclaimed QR keeps its reason and code", () => {
  assert.deepEqual(
    extractErrorDetails({
      error: { message: "Not claimed", reason: "unclaimed", qrId: "qr-1" },
    }),
    { message: "Not claimed", reason: "unclaimed", qrId: "qr-1" }
  );
});

test("fields of the wrong type are dropped, not trusted", () => {
  assert.deepEqual(
    extractErrorDetails({
      error: {
        message: "Nope",
        reason: 42,
        archivedAssetIds: ["asset-1", 7, null],
      },
    }),
    { message: "Nope", archivedAssetIds: ["asset-1"] }
  );
  assert.deepEqual(
    extractErrorDetails({ error: { message: "Nope", archivedAssetIds: "a" } }),
    { message: "Nope" }
  );
});

test("a body outside the envelope reads as no details", () => {
  assert.equal(extractErrorDetails(null), null);
  assert.equal(extractErrorDetails("<html>"), null);
  assert.equal(extractErrorDetails({ error: "flat string" }), null);
  assert.equal(extractErrorDetails({ error: { reason: "archived" } }), null);
});
