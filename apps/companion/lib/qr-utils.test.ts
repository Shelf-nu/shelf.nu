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
  type ScannedCodeClassification,
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

// ── classifyScannedCode: one row per input class ─────────

/** Where a scan ends up once the lookup it was sent to has answered. */
type Outcome =
  | "qr route"
  | "sam or barcode lookup"
  | "resolved as linked barcode"
  | "different shelf server";

/**
 * Follows a classification through the screens' flow: the QR route for `qr`,
 * the barcode lookup for everything else that is not `foreign`, and
 * {@link isForeignCodeMiss} on the lookup's answer.
 */
function outcomeOf(
  scanned: ScannedCodeClassification,
  barcodeLookupStatus: number
): Outcome {
  if (scanned.kind === "qr") return "qr route";
  if (scanned.kind === "foreign") return "different shelf server";
  if (isForeignCodeMiss(scanned, barcodeLookupStatus)) {
    return "different shelf server";
  }
  return scanned.kind === "foreign-barcode"
    ? "resolved as linked barcode"
    : "sam or barcode lookup";
}

/** Outside QR url shapes; `other-vendor.example` is a previous system's host. */
const OUTSIDE_QR = "http://other-vendor.example/qr/a1B2c3D4";
const OTHER_SHELF = `https://other-shelf.example/qr/${ID}`;

const CASES: {
  input: string;
  name: string;
  barcodes: boolean;
  /** Status the workspace barcode lookup answers with, when it is asked. */
  lookup: number;
  kind: ScannedCodeClassification["kind"];
  outcome: Outcome;
}[] = [
  {
    name: "Shelf app link",
    input: `${ACTIVE}/qr/${ID}`,
    barcodes: true,
    lookup: 404,
    kind: "qr",
    outcome: "qr route",
  },
  {
    name: "shortener link",
    input: `https://eam.sh/${ID}`,
    barcodes: true,
    lookup: 404,
    kind: "qr",
    outcome: "qr route",
  },
  {
    name: "self-hosted shortener link",
    input: `https://acme.link/${ID}`,
    barcodes: false,
    lookup: 404,
    kind: "qr",
    outcome: "qr route",
  },
  {
    name: "raw qr id",
    input: ID,
    barcodes: false,
    lookup: 404,
    kind: "qr",
    outcome: "qr route",
  },
  {
    name: "our link on a different Shelf server",
    input: OTHER_SHELF,
    barcodes: true,
    lookup: 404,
    kind: "foreign-barcode",
    outcome: "different shelf server",
  },
  {
    name: "our link on a different Shelf server, barcodes off",
    input: OTHER_SHELF,
    barcodes: false,
    lookup: 404,
    kind: "foreign",
    outcome: "different shelf server",
  },
  {
    name: "outside /qr/ url linked as ExternalQR",
    input: OUTSIDE_QR,
    barcodes: true,
    lookup: 200,
    kind: "foreign-barcode",
    outcome: "resolved as linked barcode",
  },
  {
    name: "outside /qr/ url that is not linked",
    input: OUTSIDE_QR,
    barcodes: true,
    lookup: 404,
    kind: "foreign-barcode",
    outcome: "different shelf server",
  },
  {
    name: "outside url of another shape",
    input: "https://other-vendor.example/item/42",
    barcodes: true,
    lookup: 404,
    kind: "code",
    outcome: "sam or barcode lookup",
  },
  {
    name: "plain barcode (EAN-13)",
    input: "4006381333931",
    barcodes: true,
    lookup: 200,
    kind: "code",
    outcome: "sam or barcode lookup",
  },
  {
    name: "plain barcode (Code128)",
    input: "ABC-123/x",
    barcodes: true,
    lookup: 404,
    kind: "code",
    outcome: "sam or barcode lookup",
  },
  {
    name: "SAM id",
    input: "SAM-0001",
    barcodes: false,
    lookup: 404,
    kind: "code",
    outcome: "sam or barcode lookup",
  },
];

for (const row of CASES) {
  test(`classifyScannedCode: ${row.name}`, () => {
    const scanned = classifyScannedCode(row.input, ACTIVE, row.barcodes);
    assert.equal(scanned.kind, row.kind);
    assert.equal(outcomeOf(scanned, row.lookup), row.outcome);
  });
}

test("classifyScannedCode hands the QR route only ids this server minted", () => {
  // A foreign url's tail is another system's id; on the QR route it could
  // only miss, or hit an unrelated code that shares the id.
  assert.deepEqual(classifyScannedCode(`${ACTIVE}/qr/${ID}`, ACTIVE, true), {
    kind: "qr",
    qrId: ID,
  });
  for (const value of [OUTSIDE_QR, OTHER_SHELF]) {
    assert.notEqual(classifyScannedCode(value, ACTIVE, true).kind, "qr", value);
  }
});

test("regression: a linked outside /qr/ url reaches the barcode lookup", () => {
  // Pins the case that has never resolved on the phone: since the scanner
  // was added, any-host /qr/<id> urls went to the QR route (then, from
  // 4794e08bb, straight to "Different Shelf Server"), so the barcode lookup
  // that holds the ExternalQR value was never asked.
  const scanned = classifyScannedCode(OUTSIDE_QR, ACTIVE, true);
  assert.equal(scanned.kind, "foreign-barcode");
  assert.equal(isForeignCodeMiss(scanned, 200), false);
});

// ── isForeignCodeMiss ────────────────────────────────────

test("isForeignCodeMiss keeps the server's answer for every other failure", () => {
  const scanned = classifyScannedCode(OUTSIDE_QR, ACTIVE, true);
  // 422 = found but linked to nothing; 409 = in several workspaces; no status
  // = no answer (offline). Each has its own, more accurate message.
  for (const status of [422, 409, 500, undefined]) {
    assert.equal(isForeignCodeMiss(scanned, status), false, String(status));
  }
  // An ordinary barcode miss stays "not found" in this workspace.
  const plain = classifyScannedCode("4006381333931", ACTIVE, true);
  assert.equal(isForeignCodeMiss(plain, 404), false);
});
