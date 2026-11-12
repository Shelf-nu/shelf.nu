/**
 * Tests for audit scan queue ownership.
 *
 * @see ./scan-queue-owner.ts
 */
import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  createQueueGate,
  drainMayContinue,
  queueThenRecord,
  resolveQueueAccess,
} from "./scan-queue-owner";
import { drainScanQueue } from "./audit-scan-queue";

test("the first signed-in account becomes the owner", () => {
  assert.deepEqual(resolveQueueAccess(null, "user_a"), {
    owner: "user_a",
    maySave: true,
    mayUse: true,
  });
});

test("nothing is saved or sent while no account is known", () => {
  assert.deepEqual(resolveQueueAccess(null, undefined), {
    owner: null,
    maySave: false,
    mayUse: false,
  });
});

test("another account neither adds to nor submits the owner's queue", () => {
  assert.deepEqual(resolveQueueAccess("user_a", "user_b"), {
    owner: "user_a",
    maySave: true,
    mayUse: false,
  });
});

test("after sign-out the queue is still saved to its owner's draft", () => {
  assert.deepEqual(resolveQueueAccess("user_a", undefined), {
    owner: "user_a",
    maySave: true,
    mayUse: false,
  });
});

describe("createQueueGate", () => {
  it("makes the first account seen the owner, for good", () => {
    const gate = createQueueGate();
    gate.observe("user_a", 0);
    gate.observe("user_b", 0);

    assert.equal(gate.owner(), "user_a");
  });

  it("refuses adding and sending for another account or nobody", () => {
    const gate = createQueueGate();
    gate.observe("user_a", 0);
    assert.equal(gate.mayUse(), true);

    gate.observe("user_b", 0);
    assert.equal(gate.mayUse(), false);
    gate.observe(undefined, 0);
    assert.equal(gate.mayUse(), false);
    assert.equal(gate.maySave(), true);

    gate.observe("user_a", 0);
    assert.equal(gate.mayUse(), true);
  });

  it("saves nothing before any account is seen", () => {
    const gate = createQueueGate();
    gate.observe(undefined, 0);

    assert.equal(gate.maySave(), false);
    assert.equal(gate.mayUse(), false);
  });
});

describe("drainMayContinue", () => {
  /** Three queued scans and a drain that records what it sent. */
  async function drain(options: {
    onSend?: (assetId: string) => void;
    mayContinue: () => boolean;
  }) {
    const queue = ["a-1", "a-2", "a-3"].map((assetId) => ({
      auditSessionId: "audit-1",
      assetId,
      qrId: `qr-${assetId}`,
    }));
    const sent: string[] = [];
    await drainScanQueue({
      queue: { current: queue },
      failed: { current: [] },
      items: { current: [] },
      maxRetries: 3,
      recordScan: async (entry) => {
        sent.push(entry.assetId);
        options.onSend?.(entry.assetId);
        return { data: { auditAssetId: `row-${entry.assetId}` }, error: null };
      },
      persist: () => {},
      mayContinue: options.mayContinue,
    });
    return sent;
  }

  it("keeps sending for the owner after the scan screen closes", async () => {
    const gate = createQueueGate();
    gate.observe("user_a", 0);
    const account = { current: () => 0 };

    // The screen unmounting changes nothing the guard reads: the gate keeps
    // its owner and the account counter does not move.
    const sent = await drain({ mayContinue: drainMayContinue(gate, account) });

    assert.deepEqual(sent, ["a-1", "a-2", "a-3"]);
  });

  it("stops once the account changes, even after the screen is gone", async () => {
    const gate = createQueueGate();
    gate.observe("user_a", 0);
    let generation = 0;
    const account = { current: () => generation };

    const sent = await drain({
      mayContinue: drainMayContinue(gate, account),
      onSend: (assetId) => {
        if (assetId === "a-1") generation += 1; // sign-out after the first send
      },
    });

    assert.deepEqual(sent, ["a-1"]);
  });
});

describe("drainMayContinue after the account moved", () => {
  it("refuses a drain started after the owner's session ended", () => {
    const gate = createQueueGate();
    let generation = 0;
    gate.observe("user_a", generation);
    const account = { current: () => generation };

    generation += 1; // A signs out (screen already closed: no observe)
    generation += 1; // B signs in

    const mayContinue = drainMayContinue(gate, account);
    assert.equal(mayContinue(), false);
  });

  it("allows sending again once the owner is seen signed in again", () => {
    const gate = createQueueGate();
    let generation = 0;
    gate.observe("user_a", generation);
    const account = { current: () => generation };

    generation += 1;
    gate.observe(undefined, generation); // signed out, screen still open
    generation += 1;
    gate.observe("user_a", generation); // the owner is back

    assert.equal(drainMayContinue(gate, account)(), true);
  });
});

describe("queueThenRecord", () => {
  it("records a queued scan", () => {
    const calls: string[] = [];
    const queued = queueThenRecord(() => true, "scan", {
      record: () => calls.push("record"),
      refuse: () => calls.push("refuse"),
    });

    assert.equal(queued, true);
    assert.deepEqual(calls, ["record"]);
  });

  it("never counts a refused scan, and says so", () => {
    const calls: string[] = [];
    const queued = queueThenRecord(() => false, "scan", {
      record: () => calls.push("record"),
      refuse: () => calls.push("refuse"),
    });

    assert.equal(queued, false);
    assert.deepEqual(calls, ["refuse"]);
  });
});
