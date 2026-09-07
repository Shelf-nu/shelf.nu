/**
 * Tests for scanned-code parsing and the active-server check.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./qr-utils.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyScannedCode, extractQrId } from "./qr-utils";

const ACTIVE = "https://app.shelf.nu";
/** A QR id in the shape the shortener regex accepts: 10-25 lowercase alnum. */
const ID = "abcdefghij";

// ── extractQrId ──────────────────────────────────────────

test("extractQrId reads all three supported formats", () => {
  assert.equal(extractQrId(`${ACTIVE}/qr/${ID}`), ID);
  assert.equal(extractQrId(`https://eam.sh/${ID}`), ID);
  assert.equal(extractQrId(ID), ID);
});

test("extractQrId returns null for anything that isn't a Shelf code", () => {
  for (const input of ["", "https://example.com/", "hello world", "12345"]) {
    assert.equal(extractQrId(input), null, JSON.stringify(input));
  }
});

// ── classifyScannedCode ──────────────────────────────────

test("classifyScannedCode admits a short link whose origin differs", () => {
  // Shelf Cloud mints labels on its shortener domain (URL_SHORTENER), so this
  // is the ordinary case for a Cloud user, not an edge case. Judging it by
  // origin would reject every QR code the instance has ever printed.
  const result = classifyScannedCode(`https://eam.sh/${ID}`, ACTIVE);
  assert.deepEqual(result, { kind: "id", qrId: ID });
});

test("classifyScannedCode admits a short link on any shortener domain", () => {
  // A self-hosted instance sets its own shortener, and the app is never told
  // what it is, so no shortener origin can be treated as more valid.
  const result = classifyScannedCode(`https://acme.link/${ID}`, ACTIVE);
  assert.deepEqual(result, { kind: "id", qrId: ID });
});

test("classifyScannedCode rejects a canonical QR URL from another server", () => {
  // The canonical label names the instance that minted it, so a mismatch here
  // really does mean another server — the one case the check exists for.
  const result = classifyScannedCode(`https://other.example/qr/${ID}`, ACTIVE);
  assert.deepEqual(result, { kind: "foreign" });
});

test("classifyScannedCode accepts a canonical QR URL from the active server", () => {
  const result = classifyScannedCode(`${ACTIVE}/qr/${ID}`, ACTIVE);
  assert.deepEqual(result, { kind: "id", qrId: ID });
});

test("classifyScannedCode accepts a bare id, which names no host", () => {
  const result = classifyScannedCode(ID, ACTIVE);
  assert.deepEqual(result, { kind: "id", qrId: ID });
});

test("classifyScannedCode reports a non-Shelf value as unknown", () => {
  const result = classifyScannedCode("https://example.com/not-a-code", ACTIVE);
  assert.deepEqual(result, { kind: "unknown" });
});
