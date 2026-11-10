/**
 * Tests for audit scan queue ownership.
 *
 * @see ./scan-queue-owner.ts
 */
import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import { createQueueGate, resolveQueueAccess } from "./scan-queue-owner";

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

  it("stops when the screen closes", () => {
    const gate = createQueueGate();
    gate.observe("user_a");
    gate.stop();

    assert.equal(gate.mayUse(), false);
    gate.start();
    assert.equal(gate.mayUse(), true);
  });

  it("saves nothing before any account is seen", () => {
    const gate = createQueueGate();
    gate.observe(undefined);

    assert.equal(gate.maySave(), false);
    assert.equal(gate.mayUse(), false);
  });
});
