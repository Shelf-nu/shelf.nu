/**
 * The scanner's "Update location" save: the order of its two requests, what
 * it reports, and what the scan list keeps.
 *
 * @see {@link file://./location-save.ts}
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rowsLeftAfterLocationSave,
  savedPartNotice,
  sendLocationParts,
} from "./location-save";

const ok = () => Promise.resolve({ error: null });
const refused = (message: string, errorDetails?: unknown) => () =>
  Promise.resolve({ error: message, errorDetails });

const LIST = [
  { type: "asset" as const, qrId: "qr-a" },
  { type: "kit" as const, qrId: "qr-k" },
  { type: "asset" as const, qrId: "qr-pool" },
];

test("sends the assets before the kits, never both at once", async () => {
  const order: string[] = [];
  await sendLocationParts({
    sendAssets: async () => {
      order.push("assets:start");
      await Promise.resolve();
      order.push("assets:end");
      return { error: null };
    },
    sendKits: () => {
      order.push("kits:start");
      return Promise.resolve({ error: null });
    },
  });
  assert.deepEqual(order, ["assets:start", "assets:end", "kits:start"]);
});

test("a save where both parts saved reports no error", async () => {
  const result = await sendLocationParts({ sendAssets: ok, sendKits: ok });
  assert.equal(result.error, null);
  assert.deepEqual(result.parts, { assets: "success", kits: "success" });
  assert.deepEqual(rowsLeftAfterLocationSave(LIST, result.parts), []);
  assert.equal(savedPartNotice(result.parts), null);
});

test("refused assets still let the kits move, and only the asset rows stay", async () => {
  const result = await sendLocationParts({
    sendAssets: refused("1 quantity-tracked asset can't be moved this way", {
      reason: "x",
    }),
    sendKits: ok,
  });
  assert.equal(
    result.error,
    "1 quantity-tracked asset can't be moved this way"
  );
  assert.deepEqual(result.parts, { assets: "error", kits: "success" });
  assert.deepEqual(result.assetErrorDetails, { reason: "x" });
  assert.deepEqual(
    rowsLeftAfterLocationSave(LIST, result.parts).map((i) => i.qrId),
    ["qr-a", "qr-pool"]
  );
  assert.equal(
    savedPartNotice(result.parts),
    "The kits were moved and taken off the list."
  );
});

test("refused kits keep the kit rows, and the saved assets leave", async () => {
  const result = await sendLocationParts({
    sendAssets: ok,
    sendKits: refused("Kit is checked out"),
  });
  assert.equal(result.error, "Kit is checked out");
  assert.deepEqual(
    rowsLeftAfterLocationSave(LIST, result.parts).map((i) => i.qrId),
    ["qr-k"]
  );
  assert.equal(
    savedPartNotice(result.parts),
    "The assets were moved and taken off the list."
  );
});

test("when both parts are refused the whole list stays", async () => {
  const result = await sendLocationParts({
    sendAssets: refused("assets refused"),
    sendKits: refused("kits refused"),
  });
  // The later answer is the one reported, as on the web.
  assert.equal(result.error, "kits refused");
  assert.deepEqual(rowsLeftAfterLocationSave(LIST, result.parts), LIST);
  assert.equal(savedPartNotice(result.parts), null);
});

test("a list with no kits sends only the assets", async () => {
  const result = await sendLocationParts({ sendAssets: ok, sendKits: null });
  assert.deepEqual(result.parts, { assets: "success", kits: "skipped" });
  assert.equal(result.error, null);
  assert.equal(savedPartNotice(result.parts), null);
});

test("refused assets with no kits in the list keep every row and add no notice", async () => {
  const result = await sendLocationParts({
    sendAssets: refused("assets refused"),
    sendKits: null,
  });
  assert.deepEqual(result.parts, { assets: "error", kits: "skipped" });
  assert.equal(savedPartNotice(result.parts), null);
});
