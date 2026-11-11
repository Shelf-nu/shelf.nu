/**
 * Tests for the re-check throttle: a burst of requests costs at most two runs
 * (one now, one at the end of the gap) and the last request is never lost.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRecheckThrottle } from "./recheck-throttle";

/** A hand-driven clock with one timer slot, enough for this throttle. */
function fakeTimers() {
  let now = 0;
  let timer: { at: number; fn: () => void } | null = null;
  return {
    timers: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        timer = { at: now + ms, fn };
        return timer;
      },
      clearTimer: () => {
        timer = null;
      },
    },
    /** Moves the clock and fires the timer when its time comes. */
    advance(ms: number) {
      now += ms;
      if (timer && timer.at <= now) {
        const { fn } = timer;
        timer = null;
        fn();
      }
    },
  };
}

describe("createRecheckThrottle", () => {
  test("runs the first request at once", () => {
    const clock = fakeTimers();
    let runs = 0;
    const throttle = createRecheckThrottle({
      gapMs: 15_000,
      run: () => runs++,
      timers: clock.timers,
    });

    throttle.request();

    assert.equal(runs, 1);
  });

  test("folds requests inside the gap into one run at its end", () => {
    const clock = fakeTimers();
    let runs = 0;
    const throttle = createRecheckThrottle({
      gapMs: 15_000,
      run: () => runs++,
      timers: clock.timers,
    });

    throttle.request();
    clock.advance(1_000);
    throttle.request();
    throttle.request();
    clock.advance(13_000);
    assert.equal(runs, 1, "nothing more before the gap ends");

    clock.advance(1_000);
    assert.equal(runs, 2, "one trailing run, not one per request");
  });

  test("runs at once again after the gap", () => {
    const clock = fakeTimers();
    let runs = 0;
    const throttle = createRecheckThrottle({
      gapMs: 15_000,
      run: () => runs++,
      timers: clock.timers,
    });

    throttle.request();
    clock.advance(20_000);
    throttle.request();

    assert.equal(runs, 2);
  });

  test("cancel drops a pending trailing run", () => {
    const clock = fakeTimers();
    let runs = 0;
    const throttle = createRecheckThrottle({
      gapMs: 15_000,
      run: () => runs++,
      timers: clock.timers,
    });

    throttle.request();
    throttle.request();
    throttle.cancel();
    clock.advance(30_000);

    assert.equal(runs, 1);
  });
});
