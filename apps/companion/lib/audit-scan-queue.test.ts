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
  auditScanDecision,
  carryFirstScan,
  countExpectation,
  countSheetDefault,
  countWasRefused,
  countFieldsFromScan,
  countTargetFor,
  drainScanQueue,
  dropSupersededCounts,
  entriesToResync,
  isSupersededCount,
  recountAnswerToast,
  recountQueueEntry,
  storedCountFor,
  type CountedQueueEntry,
  type ReplayAnswer,
  type ReplayQueueEntry,
  type ReplayScannedItem,
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

describe("countExpectation", () => {
  it("shows the expected units of a listed asset as the target", () => {
    assert.equal(
      countExpectation({ isExpected: true, expectedQuantity: 14 }),
      "expected"
    );
  });

  it("has no target when a listed asset expects nothing", () => {
    // A pool added to a location audit with no units placed there.
    assert.equal(
      countExpectation({ isExpected: true, expectedQuantity: 0 }),
      "none-expected"
    );
  });

  it("has no target for an asset not on the list", () => {
    assert.equal(
      countExpectation({ isExpected: false, expectedQuantity: 50 }),
      "unlisted"
    );
  });
});

describe("countWasRefused", () => {
  it("is true when the server kept another count", () => {
    assert.equal(countWasRefused(9, 6), true);
    assert.equal(countWasRefused(9, null), true);
  });

  it("is false when the count stuck or no count is known", () => {
    assert.equal(countWasRefused(9, 9), false);
    assert.equal(countWasRefused(9, undefined), false);
    assert.equal(countWasRefused(undefined, 6), false);
  });
});

describe("countSheetDefault", () => {
  it("opens on the count already recorded", () => {
    assert.equal(
      countSheetDefault({
        isExpected: true,
        expectedQuantity: 14,
        foundQuantity: 8,
      }),
      8
    );
  });

  it("opens on the expected units of a listed pool", () => {
    assert.equal(
      countSheetDefault({
        isExpected: true,
        expectedQuantity: 14,
        foundQuantity: null,
      }),
      14
    );
  });

  it("opens blank when nothing is expected or the asset is not on the list", () => {
    assert.equal(
      countSheetDefault({
        isExpected: true,
        expectedQuantity: 0,
        foundQuantity: null,
      }),
      null
    );
    assert.equal(
      countSheetDefault({
        isExpected: false,
        expectedQuantity: 50,
        foundQuantity: null,
      }),
      null
    );
  });
});

describe("carryFirstScan", () => {
  it("makes a recount a first scan when it replaces an unsent first scan", () => {
    const first = entry({ foundQuantity: 5, queuedAt: 1 });
    const recount = entry({ foundQuantity: 9, queuedAt: 2, recount: true });
    assert.equal(carryFirstScan(recount, [first]).recount, false);
  });

  it("keeps a recount that replaces only older recounts", () => {
    const older = entry({ foundQuantity: 5, queuedAt: 1, recount: true });
    const recount = entry({ foundQuantity: 9, queuedAt: 2, recount: true });
    assert.equal(carryFirstScan(recount, [older]).recount, true);
  });

  it("ignores entries for other assets", () => {
    const other = entry({ assetId: "camera-1", foundQuantity: 1 });
    const recount = entry({ foundQuantity: 9, queuedAt: 2, recount: true });
    assert.equal(carryFirstScan(recount, [other]).recount, true);
  });
});

describe("auditScanDecision", () => {
  const pool = { type: "QUANTITY_TRACKED", quantity: 20, unitOfMeasure: "pcs" };
  const camera = { type: "INDIVIDUAL" };

  it("asks the first count of a listed pool against its row's snapshot", () => {
    assert.deepEqual(
      auditScanDecision({
        scannedRow: undefined,
        expectedRecord: { expectedQuantity: 14, unitOfMeasure: "pcs" },
        lookedUp: pool,
        isExpected: true,
      }),
      {
        kind: "first",
        expectedQuantity: 14,
        isExpected: true,
        unitOfMeasure: "pcs",
      }
    );
  });

  it("asks the first count of an unlisted pool", () => {
    assert.equal(
      auditScanDecision({
        scannedRow: undefined,
        expectedRecord: undefined,
        lookedUp: pool,
        isExpected: false,
      }).kind,
      "first"
    );
  });

  it("recounts a pool already scanned, keeping its row's numbers", () => {
    assert.deepEqual(
      auditScanDecision({
        scannedRow: {
          isExpected: true,
          expectedQuantity: 14,
          foundQuantity: 8,
          unitOfMeasure: "pcs",
        },
        expectedRecord: { expectedQuantity: 14 },
        lookedUp: pool,
        isExpected: true,
      }),
      {
        kind: "recount",
        expectedQuantity: 14,
        foundQuantity: 8,
        isExpected: true,
        unitOfMeasure: "pcs",
      }
    );
  });

  it("treats a second scan of an individual asset as a duplicate", () => {
    assert.deepEqual(
      auditScanDecision({
        scannedRow: { isExpected: true },
        expectedRecord: { expectedQuantity: null },
        lookedUp: camera,
        isExpected: true,
      }),
      { kind: "duplicate" }
    );
  });

  it("records the first scan of an individual asset without a count", () => {
    assert.deepEqual(
      auditScanDecision({
        scannedRow: undefined,
        expectedRecord: { expectedQuantity: null },
        lookedUp: camera,
        isExpected: true,
      }),
      { kind: "record", isExpected: true }
    );
  });
});

describe("recountQueueEntry", () => {
  it("marks the entry as a recount, so crash recovery replays it", () => {
    const queued = recountQueueEntry({
      auditSessionId: "audit-1",
      qrId: "qr-1",
      assetId: "pool-1",
      isExpected: true,
      foundQuantity: 9,
    });
    assert.equal(queued.recount, true);
    assert.deepEqual(entriesToResync([queued], [], new Set(["pool-1"])), [
      queued,
    ]);
  });
});

describe("recountAnswerToast", () => {
  const pending = {
    assetTitle: "Sandbag",
    entered: 12,
    expectedQuantity: 14,
    isExpected: true,
  };

  it("reports a saved recount only once the server stored it", () => {
    assert.deepEqual(recountAnswerToast(pending, 12), {
      type: "found",
      title: "Sandbag",
      subtitle: "Count updated · 12 of 14",
    });
  });

  it("reports a recount the finished audit refused, with the kept count", () => {
    // The audit was completed on the web; the server answers 200 with 11.
    assert.deepEqual(recountAnswerToast(pending, 11), {
      type: "error",
      title: "Sandbag",
      subtitle: "Count not saved: the audit kept 11",
    });
  });

  it("reports a recount of a scan removed in the meantime", () => {
    assert.equal(
      recountAnswerToast(pending, null)?.subtitle,
      "Count not saved: the scan is no longer in this audit"
    );
  });

  it("waits when a newer count will answer instead", () => {
    assert.equal(recountAnswerToast(pending, undefined), null);
  });

  it("leaves out the target for an unlisted pool", () => {
    assert.equal(
      recountAnswerToast({ ...pending, isExpected: false }, 12)?.subtitle,
      "Count updated · 12"
    );
  });
});

describe("drainScanQueue", () => {
  type Entry = ReplayQueueEntry & { qrId: string };

  /** A queued scan of the 14-unit pool, or of another asset. */
  const queued = (overrides: Partial<Entry>): Entry => ({
    auditSessionId: "audit-1",
    assetId: "pool-1",
    qrId: "qr-1",
    ...overrides,
  });

  /**
   * Runs the replay against a fake server that answers each request from
   * `answers` in turn (a thrown error stands for a network failure), and
   * records what was sent and reported.
   */
  async function replay({
    queue,
    failed = [],
    items = [{ assetId: "pool-1" }],
    answers,
    maxRetries = 3,
  }: {
    queue: Entry[];
    failed?: Entry[];
    items?: ReplayScannedItem[];
    answers: (ReplayAnswer | Error)[];
    maxRetries?: number;
  }) {
    const sent: Entry[] = [];
    const synced: unknown[][] = [];
    const failures: string[] = [];
    let persisted = 0;
    const refs = {
      queue: { current: queue },
      failed: { current: failed },
      items: { current: items },
    };
    const result = await drainScanQueue({
      ...refs,
      maxRetries,
      recordScan: async (entry) => {
        sent.push(entry);
        const answer = answers.shift();
        if (!answer) throw new Error("no answer scripted");
        if (answer instanceof Error) throw answer;
        return answer;
      },
      persist: () => {
        persisted += 1;
      },
      onSynced: (...args) => synced.push(args),
      onFailed: (entry) => failures.push(entry.assetId),
    });
    return { result, refs, sent, synced, failures, persisted };
  }

  it("sends every scan in order and gives each row its server row and count", async () => {
    const run = await replay({
      queue: [
        queued({ foundQuantity: 8 }),
        queued({ assetId: "camera-1", qrId: "qr-2" }),
      ],
      items: [{ assetId: "pool-1" }, { assetId: "camera-1" }],
      answers: [
        { data: { auditAssetId: "row-pool", foundQuantity: 8 } },
        { data: { auditAssetId: "row-camera", foundQuantity: null } },
      ],
    });

    assert.deepEqual(run.result, { backoffAttempt: null });
    assert.deepEqual(
      run.sent.map((e) => e.assetId),
      ["pool-1", "camera-1"]
    );
    assert.equal(run.refs.queue.current.length, 0);
    assert.deepEqual(run.refs.items.current[0], {
      assetId: "pool-1",
      auditAssetId: "row-pool",
      syncFailed: false,
      foundQuantity: 8,
    });
    assert.deepEqual(run.synced[0], ["pool-1", "row-pool", 8, false]);
    assert.equal(run.persisted, 2);
  });

  it("reports a recount the server refused with the count it kept", async () => {
    const run = await replay({
      queue: [queued({ foundQuantity: 12, recount: true })],
      answers: [{ data: { auditAssetId: "row-pool", foundQuantity: 11 } }],
    });

    assert.deepEqual(run.synced[0], ["pool-1", "row-pool", 11, true]);
    assert.equal(run.refs.items.current[0].foundQuantity, 11);
  });

  it("lets a newer queued count settle the row instead of an older answer", async () => {
    const run = await replay({
      queue: [
        queued({ foundQuantity: 8, queuedAt: 1 }),
        queued({ foundQuantity: 10, queuedAt: 2, recount: true }),
      ],
      answers: [
        { data: { auditAssetId: "row-pool", foundQuantity: 8 } },
        { data: { auditAssetId: "row-pool", foundQuantity: 10 } },
      ],
    });

    // The first answer leaves the count alone: the newer one is queued.
    assert.deepEqual(run.synced[0], ["pool-1", "row-pool", undefined, false]);
    assert.deepEqual(run.synced[1], ["pool-1", "row-pool", 10, false]);
    assert.equal(run.refs.items.current[0].foundQuantity, 10);
  });

  it("drops a failed count with a newer one queued, so it can never land after it", async () => {
    const run = await replay({
      queue: [
        queued({ foundQuantity: 8, queuedAt: 1 }),
        queued({ foundQuantity: 10, queuedAt: 2, recount: true }),
      ],
      answers: [
        new Error("offline"),
        { data: { auditAssetId: "row-pool", foundQuantity: 10 } },
      ],
    });

    // Sent once each: the older count is not retried after the newer one.
    assert.deepEqual(
      run.sent.map((e) => e.foundQuantity),
      [8, 10]
    );
    assert.equal(run.refs.queue.current.length, 0);
    assert.equal(run.refs.items.current[0].foundQuantity, 10);
  });

  it("makes the newer count a first scan when the dropped one never reached the server", async () => {
    const run = await replay({
      queue: [
        queued({ foundQuantity: 8, queuedAt: 1 }),
        queued({ foundQuantity: 10, queuedAt: 2, recount: true }),
      ],
      answers: [
        new Error("offline"),
        { data: { auditAssetId: "row-pool", foundQuantity: 10 } },
      ],
    });

    assert.equal(run.sent[1].recount, false);
  });

  it("carries the first scan into a newer count waiting in the failed list", async () => {
    const run = await replay({
      queue: [queued({ foundQuantity: 8, queuedAt: 1 })],
      failed: [queued({ foundQuantity: 10, queuedAt: 2, recount: true })],
      answers: [{ error: "Server error" }],
    });

    assert.equal(run.refs.queue.current.length, 0);
    assert.equal(run.refs.failed.current.length, 1);
    assert.equal(run.refs.failed.current[0].recount, false);
    assert.equal(run.refs.failed.current[0].foundQuantity, 10);
  });

  it("puts a failed scan at the back with one more retry and stops to back off", async () => {
    const run = await replay({
      queue: [queued({}), queued({ assetId: "camera-1", qrId: "qr-2" })],
      items: [{ assetId: "pool-1" }, { assetId: "camera-1" }],
      answers: [{ error: "Server error" }],
    });

    assert.deepEqual(run.result, { backoffAttempt: 1 });
    assert.deepEqual(
      run.refs.queue.current.map((e) => [e.assetId, e.retryCount]),
      [
        ["camera-1", undefined],
        ["pool-1", 1],
      ]
    );
    assert.equal(run.sent.length, 1);
  });

  it("moves a scan out of retries to the failed list and marks its row, never dropping it", async () => {
    const run = await replay({
      queue: [queued({ foundQuantity: 8, retryCount: 2 })],
      answers: [new Error("offline")],
    });

    assert.deepEqual(run.result, { backoffAttempt: null });
    assert.equal(run.refs.queue.current.length, 0);
    assert.deepEqual(run.refs.failed.current, [
      queued({ foundQuantity: 8, retryCount: undefined }),
    ]);
    assert.equal(run.refs.items.current[0].syncFailed, true);
    assert.deepEqual(run.failures, ["pool-1"]);
  });

  it("updates the rows the screen holds now, not the array it held when the request left", async () => {
    const queue = [queued({ foundQuantity: 8 })];
    const items = { current: [{ assetId: "pool-1" }] as ReplayScannedItem[] };
    const swapped: ReplayScannedItem[] = [
      { assetId: "pool-1" },
      { assetId: "camera-1" },
    ];
    await drainScanQueue({
      queue: { current: queue },
      failed: { current: [] },
      items,
      maxRetries: 3,
      recordScan: async () => {
        // A scan made while the request was in flight replaced the array.
        items.current = swapped;
        return { data: { auditAssetId: "row-pool", foundQuantity: 8 } };
      },
      persist: () => {},
    });

    assert.equal(swapped[0].auditAssetId, "row-pool");
  });
});

describe("drainScanQueue with mayContinue", () => {
  it("stops before the next send and leaves the rest queued", async () => {
    const queue = [
      { auditSessionId: "audit-1", assetId: "a-1", qrId: "qr-1" },
      { auditSessionId: "audit-1", assetId: "a-2", qrId: "qr-2" },
    ];
    const sent: string[] = [];
    let allowed = 1;

    const result = await drainScanQueue({
      queue: { current: queue },
      failed: { current: [] },
      items: { current: [] },
      maxRetries: 3,
      recordScan: async (entry) => {
        sent.push(entry.assetId);
        return { data: { auditAssetId: `row-${entry.assetId}` }, error: null };
      },
      persist: () => {},
      mayContinue: () => allowed-- > 0,
    });

    assert.deepEqual(sent, ["a-1"]);
    assert.deepEqual(
      queue.map((e) => e.assetId),
      ["a-2"]
    );
    assert.deepEqual(result, { backoffAttempt: null });
  });
});
