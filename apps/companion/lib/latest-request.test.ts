import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chainAbort, createLatestRequest } from "./latest-request";

describe("createLatestRequest", () => {
  it("leaves the first request alone", () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    assert.equal(first.aborted, false);
  });

  it("abandons the previous request when a newer one starts", () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    const second = latest.begin();

    assert.equal(first.aborted, true, "the superseded request is abandoned");
    assert.equal(second.aborted, false, "the newest request may answer");
  });

  it("abandons every request but the last across a burst of keystrokes", () => {
    const latest = createLatestRequest();
    const signals = [latest.begin(), latest.begin(), latest.begin()];

    assert.deepEqual(
      signals.map((signal) => signal.aborted),
      [true, true, false]
    );
  });

  it("abandons an in-flight request on cancel", () => {
    const latest = createLatestRequest();
    const signal = latest.begin();
    latest.cancel();

    assert.equal(signal.aborted, true);
  });

  it("starts cleanly after a cancel", () => {
    const latest = createLatestRequest();
    latest.begin();
    latest.cancel();
    const next = latest.begin();

    assert.equal(next.aborted, false);
  });

  it("does nothing when cancelling with nothing in flight", () => {
    const latest = createLatestRequest();
    // Runs on a screen whose subject changed before it ever fetched.
    assert.doesNotThrow(() => latest.cancel());
    assert.doesNotThrow(() => latest.cancel());
  });

  it("gives each request its own signal", () => {
    const latest = createLatestRequest();
    assert.notEqual(latest.begin(), latest.begin());
  });
});

describe("chainAbort", () => {
  it("passes a later abort on to the controller", () => {
    const latest = createLatestRequest();
    const signal = latest.begin();
    const controller = new AbortController();

    chainAbort(controller, signal);
    assert.equal(controller.signal.aborted, false);

    latest.cancel();
    assert.equal(controller.signal.aborted, true);
  });

  // The gap this exists to close: a signal that aborted while the caller was
  // awaiting something else. A listener attached now is never called back, so
  // the request would run to completion and answer with data nobody wants.
  it("aborts at once for a signal that already fired", () => {
    const latest = createLatestRequest();
    const signal = latest.begin();
    latest.cancel();
    assert.equal(signal.aborted, true, "precondition: already aborted");

    const controller = new AbortController();
    chainAbort(controller, signal);

    assert.equal(controller.signal.aborted, true);
  });

  it("does nothing when the caller gave no signal", () => {
    const controller = new AbortController();
    chainAbort(controller, undefined);
    chainAbort(controller, null);

    assert.equal(controller.signal.aborted, false);
  });

  it("leaves the controller alone while the signal holds", () => {
    const controller = new AbortController();
    chainAbort(controller, createLatestRequest().begin());

    assert.equal(controller.signal.aborted, false);
  });
});

describe("reset tracking", () => {
  it("reports a reset as pending until it finishes", () => {
    const latest = createLatestRequest();
    assert.equal(latest.isResetPending(), false);

    const signal = latest.beginReset();
    assert.equal(latest.isResetPending(), true);

    latest.endReset(signal);
    assert.equal(latest.isResetPending(), false);
  });

  it("does not treat an ordinary request as a reset", () => {
    const latest = createLatestRequest();
    latest.begin();

    assert.equal(latest.isResetPending(), false);
  });

  // The regression: paging that claims the slot mid-reset abandons it and
  // appends the new query's first page to the old rows.
  it("still reports pending while paging has superseded nothing", () => {
    const latest = createLatestRequest();
    latest.beginReset();

    assert.equal(
      latest.isResetPending(),
      true,
      "paging must be refused at this point"
    );
  });

  it("lets a newer reset keep the slot when a slow one finishes late", () => {
    const latest = createLatestRequest();
    const first = latest.beginReset();
    const second = latest.beginReset();

    latest.endReset(first);
    assert.equal(
      latest.isResetPending(),
      true,
      "the second reset is still on its way"
    );

    latest.endReset(second);
    assert.equal(latest.isResetPending(), false);
  });

  it("stops reporting pending once the reset is abandoned", () => {
    const latest = createLatestRequest();
    latest.beginReset();
    // A workspace switch abandons it, and nothing will call endReset for a
    // request whose answer is never applied. Paging must not stay refused.
    latest.cancel();

    assert.equal(latest.isResetPending(), false);
  });

  it("stops reporting pending when an ordinary request supersedes the reset", () => {
    const latest = createLatestRequest();
    latest.beginReset();
    latest.begin();

    assert.equal(latest.isResetPending(), false);
  });
});
