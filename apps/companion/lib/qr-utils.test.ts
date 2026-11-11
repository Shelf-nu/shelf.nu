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

import {
  classifyScannedCode,
  extractQrId,
  isForeignCodeMiss,
  planScanLookup,
} from "./qr-utils";

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

// ── planScanLookup ───────────────────────────────────────

/**
 * A label from a system the workspace used before Shelf, linked to an asset or
 * kit as an alternative barcode (ExternalQR). Its path happens to look like a
 * Shelf label, which is exactly why it was being mistaken for one.
 */
const OTHER_VENDOR_URL = "http://other-vendor.example/qr/a1b2c3d4";

test("planScanLookup sends this server's QR URL down the QR path", () => {
  assert.deepEqual(planScanLookup(`${ACTIVE}/qr/${ID}`, ACTIVE, true), {
    kind: "qr",
    qrId: ID,
  });
});

test("planScanLookup sends a short link and a bare id down the QR path", () => {
  assert.deepEqual(planScanLookup(`https://eam.sh/${ID}`, ACTIVE, true), {
    kind: "qr",
    qrId: ID,
  });
  assert.deepEqual(planScanLookup(ID, ACTIVE, false), { kind: "qr", qrId: ID });
});

test("planScanLookup tries a foreign /qr/ URL as a linked barcode first", () => {
  // The bug: this used to be rejected as "Different Shelf Server" before the
  // workspace barcode lookup was ever asked, so a linked label never resolved.
  assert.deepEqual(planScanLookup(OTHER_VENDOR_URL, ACTIVE, true), {
    kind: "foreign-barcode",
  });
});

test("planScanLookup never hands a foreign URL's tail to the QR path", () => {
  // The tail is another system's id, not a Shelf QR id; resolving it here
  // could only miss, or worse, hit an unrelated code that shares the id.
  const plan = planScanLookup(`https://other.example/qr/${ID}`, ACTIVE, true);
  assert.notEqual(plan.kind, "qr");
});

test("planScanLookup reports a foreign URL as foreign when barcodes are off", () => {
  // Without the barcode lookup there is nothing that could match it, so the
  // other-server message is still the most useful answer.
  assert.deepEqual(planScanLookup(OTHER_VENDOR_URL, ACTIVE, false), {
    kind: "foreign",
  });
});

test("planScanLookup leaves a non-Shelf value to the SAM and barcode paths", () => {
  for (const value of ["SAM-0001", "4006381333931", "https://example.com/x"]) {
    assert.deepEqual(
      planScanLookup(value, ACTIVE, true),
      { kind: "code" },
      value
    );
  }
});

// ── isForeignCodeMiss ────────────────────────────────────

test("isForeignCodeMiss is true only for a foreign URL the lookup did not find", () => {
  const foreign = planScanLookup(OTHER_VENDOR_URL, ACTIVE, true);
  assert.equal(isForeignCodeMiss(foreign, 404), true);
});

test("isForeignCodeMiss keeps the server's answer for every other failure", () => {
  const foreign = planScanLookup(OTHER_VENDOR_URL, ACTIVE, true);
  // 422 = found but linked to nothing; 409 = in several workspaces; no status
  // = no answer (offline). Each has its own, more accurate message.
  for (const status of [422, 409, 500, undefined]) {
    assert.equal(isForeignCodeMiss(foreign, status), false, String(status));
  }
  // An ordinary barcode miss stays "not found" in this workspace.
  assert.equal(
    isForeignCodeMiss(planScanLookup("4006381333931", ACTIVE, true), 404),
    false
  );
});
