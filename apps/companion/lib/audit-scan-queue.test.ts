/**
 * Tests for the count ordering rules of the audit scan queue.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./audit-scan-queue.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countFieldsFromScan,
  countTargetFor,
  dropSupersededCounts,
  entriesToResync,
  isSupersededCount,
  storedCountFor,
  type CountedQueueEntry,
} from "./audit-scan-queue";

/** A queued scan of the 14-unit pool, or of another asset. */
function entry(overrides: Partial<CountedQueueEntry>): CountedQueueEntry {
  return { auditSessionId: "audit-1", assetId: "pool-1", ...overrides };
}

describe("dropSupersededCounts", () => {
  it("removes an earlier count for the same asset", () => {
    const queue = [entry({ foundQuantity: 6, queuedAt: 1 })];
    const kept = dropSupersededCounts(
      queue,
      entry({ foundQuantity: 9, queuedAt: 2 }),
      false
    );
    assert.deepEqual(kept, []);
  });

  it("keeps the request in flight at the head of the queue", () => {
    const inFlight = entry({ foundQuantity: 6, queuedAt: 1 });
    const kept = dropSupersededCounts(
      [inFlight],
      entry({ foundQuantity: 9, queuedAt: 2 }),
      true
    );
    assert.deepEqual(kept, [inFlight]);
  });

  it("keeps other assets, other audits and scans without a count", () => {
    const queue = [
      entry({ assetId: "camera-1" }),
      entry({ auditSessionId: "audit-2", foundQuantity: 3 }),
      entry({ assetId: "tripod-1", foundQuantity: 2 }),
    ];
    const kept = dropSupersededCounts(
      queue,
      entry({ foundQuantity: 9, queuedAt: 2 }),
      false
    );
    assert.deepEqual(kept, queue);
  });

  it("leaves the queue alone for an incoming scan without a count", () => {
    const queue = [entry({ foundQuantity: 6 })];
    assert.deepEqual(dropSupersededCounts(queue, entry({}), false), queue);
  });
});

describe("isSupersededCount", () => {
  it("is true when a newer count for the asset is waiting", () => {
    const old = entry({ foundQuantity: 6, queuedAt: 1 });
    assert.equal(
      isSupersededCount(old, [entry({ foundQuantity: 9, queuedAt: 2 })]),
      true
    );
  });

  it("is false for the newest count", () => {
    const newest = entry({ foundQuantity: 9, queuedAt: 2 });
    assert.equal(
      isSupersededCount(newest, [entry({ foundQuantity: 6, queuedAt: 1 })]),
      false
    );
  });

  it("treats an entry saved without a timestamp as the older one", () => {
    const legacy = entry({ foundQuantity: 6 });
    assert.equal(
      isSupersededCount(legacy, [entry({ foundQuantity: 9, queuedAt: 2 })]),
      true
    );
  });
});

describe("entriesToResync", () => {
  it("replays only the newest count after a crash, wherever it was saved", () => {
    const failedOld = entry({ foundQuantity: 5, queuedAt: 1, recount: true });
    const pendingNew = entry({ foundQuantity: 9, queuedAt: 2, recount: true });
    assert.deepEqual(
      entriesToResync([pendingNew], [failedOld], new Set(["pool-1"])),
      [pendingNew]
    );
  });

  it("keeps a recount of a scan the server already has", () => {
    const recount = entry({ foundQuantity: 9, queuedAt: 2, recount: true });
    assert.deepEqual(entriesToResync([recount], [], new Set(["pool-1"])), [
      recount,
    ]);
  });

  it("does not replay a counted first scan the server already has", () => {
    // It reached the server before the crash; replaying it as a recount could
    // overwrite a count corrected since.
    const firstScan = entry({ foundQuantity: 5, queuedAt: 1 });
    assert.deepEqual(entriesToResync([firstScan], [], new Set(["pool-1"])), []);
  });

  it("drops an uncounted scan the server already has", () => {
    const scan = entry({ assetId: "camera-1" });
    assert.deepEqual(entriesToResync([scan], [], new Set(["camera-1"])), []);
  });

  it("keeps an uncounted scan the server does not have", () => {
    const scan = entry({ assetId: "camera-1" });
    assert.deepEqual(entriesToResync([], [scan], new Set()), [scan]);
  });
});

describe("countTargetFor", () => {
  it("uses the audit row's snapshot for an expected asset", () => {
    assert.equal(
      countTargetFor(
        { expectedQuantity: 14 },
        { type: "QUANTITY_TRACKED", quantity: 20 }
      ),
      14
    );
  });

  it("uses the stock of an unexpected quantity-tracked asset", () => {
    assert.equal(
      countTargetFor(undefined, { type: "QUANTITY_TRACKED", quantity: 20 }),
      20
    );
  });

  it("does not count an individual asset", () => {
    assert.equal(
      countTargetFor({ expectedQuantity: null }, { type: "INDIVIDUAL" }),
      null
    );
  });
});

describe("countFieldsFromScan", () => {
  it("reads the counts of a restored scan", () => {
    // Shaped like an existingScans row of GET /api/mobile/audits/:id.
    assert.deepEqual(
      countFieldsFromScan({
        expectedQuantity: 14,
        foundQuantity: 8,
        unitOfMeasure: "pcs",
      }),
      { expectedQuantity: 14, foundQuantity: 8, unitOfMeasure: "pcs" }
    );
  });

  it("reads a scan from a server without counts as uncounted", () => {
    assert.deepEqual(countFieldsFromScan({}), {
      expectedQuantity: null,
      foundQuantity: null,
      unitOfMeasure: null,
    });
  });
});

describe("storedCountFor", () => {
  it("returns the count the server stored", () => {
    // The audit was finished before this recount landed: the server answers
    // with the count it kept.
    assert.equal(storedCountFor(9, { foundQuantity: 5 }, false), 5);
    assert.equal(storedCountFor(9, { foundQuantity: 9 }, false), 9);
  });

  it("returns null when the server kept no count", () => {
    assert.equal(storedCountFor(9, { foundQuantity: null }, false), null);
  });

  it("leaves the row alone while a newer count is queued", () => {
    // An older answer must not overwrite the newer count on the row; the
    // newer count's own answer settles it.
    assert.equal(storedCountFor(5, { foundQuantity: null }, true), undefined);
  });

  it("returns nothing for a scan sent without a count", () => {
    assert.equal(
      storedCountFor(undefined, { foundQuantity: null }, false),
      undefined
    );
  });

  it("returns nothing when the server sends no count", () => {
    assert.equal(storedCountFor(9, {}, false), undefined);
  });
});
