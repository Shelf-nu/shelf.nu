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
    gate.observe("user_a");
    gate.observe("user_b");

    assert.equal(gate.owner(), "user_a");
  });

  it("refuses adding and sending for another account or nobody", () => {
    const gate = createQueueGate();
    gate.observe("user_a");
    assert.equal(gate.mayUse(), true);

    gate.observe("user_b");
    assert.equal(gate.mayUse(), false);
    gate.observe(undefined);
    assert.equal(gate.mayUse(), false);
    assert.equal(gate.maySave(), true);

    gate.observe("user_a");
    assert.equal(gate.mayUse(), true);
  });

  it("saves nothing before any account is seen", () => {
    const gate = createQueueGate();
    gate.observe(undefined);

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
    gate.observe("user_a");
    const account = { current: () => 0 };

    // The screen unmounting changes nothing the guard reads: the gate keeps
    // its owner and the account counter does not move.
    const sent = await drain({ mayContinue: drainMayContinue(gate, account) });

    assert.deepEqual(sent, ["a-1", "a-2", "a-3"]);
  });

  it("stops once the account changes, even after the screen is gone", async () => {
    const gate = createQueueGate();
    gate.observe("user_a");
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
