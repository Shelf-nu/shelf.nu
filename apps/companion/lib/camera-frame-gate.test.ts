/**
 * Tests for the camera frame gate.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./camera-frame-gate.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFrameGate, type FrameGateState } from "./camera-frame-gate";

type Frame = { data: string };

/** A mutable stand-in for the screen state a hook would keep in a ref. */
function setup(initial: FrameGateState<Frame>) {
  const state = { current: initial };
  const gate = createFrameGate(() => state.current);
  return { state, gate };
}

test("forwards frames to the handler while nothing blocks them", () => {
  const seen: string[] = [];
  const { gate } = setup({
    ignore: false,
    handle: (e) => seen.push(e.data),
  });

  gate({ data: "qr-1" });
  gate({ data: "qr-2" });

  assert.deepEqual(seen, ["qr-1", "qr-2"]);
});

test("drops frames while ignore is set and resumes when it clears", () => {
  const seen: string[] = [];
  const handle = (e: Frame) => seen.push(e.data);
  const { state, gate } = setup({ ignore: true, handle });

  gate({ data: "while-card-up" });
  state.current = { ignore: false, handle };
  gate({ data: "after-dismiss" });

  assert.deepEqual(seen, ["after-dismiss"]);
});

test("the same gate calls whichever handler is current", () => {
  const seen: string[] = [];
  const { state, gate } = setup({
    ignore: false,
    handle: (e) => seen.push(`old:${e.data}`),
  });

  gate({ data: "a" });
  state.current = { ignore: false, handle: (e) => seen.push(`new:${e.data}`) };
  gate({ data: "b" });

  assert.deepEqual(seen, ["old:a", "new:b"]);
});
