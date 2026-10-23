/**
 * Tests for display-code selection on the detail screens.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract under test is that the SERVER picks which code leads and this
 * module only locates it. A workspace that labels its assets with Code 128
 * must get Code 128 in front of it; the app must never fall back to showing
 * the Shelf QR just because the QR happens to be listed first.
 *
 * @see ./display-codes.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCodeSelection } from "./display-codes";

const QR = [{ id: "qr-abc123" }];
const CODE128 = {
  id: "bc-1",
  type: "Code128" as const,
  value: "CODE-000128",
};

test("leads with the workspace's barcode, not the Shelf QR", () => {
  const selection = buildCodeSelection({
    displayCode: { value: "CODE-000128", isFallback: false },
    barcodes: [CODE128],
    qrCodes: QR,
  });

  // The QR is still offered, but it must not be the one on screen.
  assert.equal(selection.leadKey, "bc:bc-1");
  // Neutral heading: the reader can switch, so naming one type would
  // contradict the screen the moment they do. Web's card is the same.
  assert.equal(selection.title, "CODES");
  assert.equal(selection.fallbackNote, null);
  assert.deepEqual(
    selection.codes.map((c) => c.key),
    ["qr:qr-abc123", "bc:bc-1"]
  );
});

test("explains an unhonoured preference in the server's words", () => {
  // The workspace prints Code 128, this entity has none. Showing the QR is
  // correct, but the reader is holding a label and needs to know why. The
  // payload's `label` names the QR shown, so the note must come from
  // `fallbackNote` — reading `label` would claim the workspace shows QR codes.
  const note = "Your workspace prefers Code 128 but this item has no Code 128.";
  const selection = buildCodeSelection({
    displayCode: { value: "qr-abc123", isFallback: true, fallbackNote: note },
    barcodes: [],
    qrCodes: QR,
  });

  assert.equal(selection.leadKey, "qr:qr-abc123");
  assert.equal(selection.fallbackNote, note);
  // One code only, so the heading may name it.
  assert.equal(selection.title, "QR CODE");
});

test("passes a kit's note through unchanged", () => {
  // why: a kit can never carry a SAM ID, so the server words its fallback
  // differently. The app must show that sentence, not a generic one of its own.
  const note =
    "Your workspace prefers SAM ID, which kits do not have. Showing the QR Code ID instead.";
  const selection = buildCodeSelection({
    displayCode: { value: "qr-kit-1", isFallback: true, fallbackNote: note },
    barcodes: [],
    qrCodes: [{ id: "qr-kit-1" }],
  });

  assert.equal(selection.fallbackNote, note);
});

test("shows no note when an older server marks a fallback without words", () => {
  // why: a server from before `fallbackNote` sends only `isFallback`. The app
  // does not know the preference, so any sentence it made up would be a guess.
  const selection = buildCodeSelection({
    displayCode: { value: "qr-abc123", isFallback: true },
    barcodes: [],
    qrCodes: QR,
  });

  assert.equal(selection.leadKey, "qr:qr-abc123");
  assert.equal(selection.fallbackNote, null);
});

test("shows no note on a code that is not a fallback", () => {
  const selection = buildCodeSelection({
    displayCode: {
      value: "CODE-000128",
      isFallback: false,
      fallbackNote:
        "Your workspace prefers Code 128 but this item has no Code 128.",
    },
    barcodes: [CODE128],
    qrCodes: QR,
  });

  assert.equal(selection.fallbackNote, null);
});

test("leads with the QR when that is genuinely the preference", () => {
  const selection = buildCodeSelection({
    displayCode: { value: "qr-abc123", isFallback: false },
    barcodes: [CODE128],
    qrCodes: QR,
  });

  assert.equal(selection.leadKey, "qr:qr-abc123");
  assert.equal(selection.title, "CODES");
  assert.equal(selection.fallbackNote, null);
});

test("falls back to the first code when the server sent none", () => {
  // An older server that does not send `displayCode` at all must still render
  // a code rather than an empty section.
  const selection = buildCodeSelection({ barcodes: [], qrCodes: QR });

  assert.equal(selection.leadKey, "qr:qr-abc123");
  assert.equal(selection.title, "QR CODE");
  assert.equal(selection.fallbackNote, null);
});

test("falls back to the first code when the resolved value is not in the list", () => {
  // Codes changed between the two reads. Rendering nothing would be worse
  // than rendering the code we do have.
  const selection = buildCodeSelection({
    displayCode: { value: "GONE-999", isFallback: false },
    barcodes: [],
    qrCodes: QR,
  });

  assert.equal(selection.leadKey, "qr:qr-abc123");
});

test("reports no codes at all rather than inventing one", () => {
  const selection = buildCodeSelection({ barcodes: [], qrCodes: [] });

  assert.deepEqual(selection.codes, []);
  assert.equal(selection.leadKey, undefined);
});

test("labels an external QR by name and the rest by symbology and value", () => {
  const selection = buildCodeSelection({
    barcodes: [
      { id: "bc-x", type: "ExternalQR", value: "https://vendor.example/x" },
      CODE128,
    ],
    qrCodes: [],
  });

  assert.deepEqual(
    selection.codes.map((c) => c.label),
    ["External QR Code", "Code128 - CODE-000128"]
  );
});

test("offers a kit's barcode even though kits have no SAM ID", () => {
  // Kits carry no `sequentialId`, so a SAM_ID workspace resolves to the QR —
  // but a kit WITH a barcode and a Code 128 workspace behaves like an asset.
  const selection = buildCodeSelection({
    displayCode: { value: "KIT-000042", isFallback: false },
    barcodes: [{ id: "bc-k1", type: "Code128", value: "KIT-000042" }],
    qrCodes: [{ id: "qr-kit-1" }],
  });

  assert.equal(selection.leadKey, "bc:bc-k1");
  assert.equal(selection.title, "CODES");
});

test("names the single code in the heading when there is nothing to switch to", () => {
  // why: with one code the heading cannot contradict the screen, so it is more
  // useful naming the type than saying "CODES" over a lone QR.
  const qrOnly = buildCodeSelection({ barcodes: [], qrCodes: QR });
  assert.equal(qrOnly.title, "QR CODE");

  const barcodeOnly = buildCodeSelection({ barcodes: [CODE128], qrCodes: [] });
  assert.equal(barcodeOnly.title, "CODE128");
});

test("keeps the heading neutral once a second code exists", () => {
  // why: this is the regression the heading changed for — a card headed
  // "CODE 128" while the reader has switched it to the Shelf QR.
  const selection = buildCodeSelection({
    displayCode: { value: "CODE-000128", isFallback: false },
    barcodes: [CODE128],
    qrCodes: QR,
  });

  assert.equal(selection.title, "CODES");
});
