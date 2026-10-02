import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLatestRequest } from "./latest-request";

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
