import { describe, expect, it, vi } from "vitest";

import {
  MAX_CONCURRENT_BACKGROUND_WRITES,
  withBackgroundWriteSlot,
} from "./background-write-limiter.server";

describe("withBackgroundWriteSlot", () => {
  it("runs the task and returns its resolved value", async () => {
    await expect(
      withBackgroundWriteSlot(() => Promise.resolve(42))
    ).resolves.toBe(42);
  });

  it("releases the slot and rethrows when the task rejects", async () => {
    await expect(
      withBackgroundWriteSlot(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");

    // The slot must have been released despite the rejection — a later task
    // still acquires and runs.
    await expect(
      withBackgroundWriteSlot(() => Promise.resolve("ok"))
    ).resolves.toBe("ok");
  });

  it("never runs more than MAX_CONCURRENT_BACKGROUND_WRITES tasks at once", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll!: () => void;
    // All tasks park on this shared barrier so we can hold every acquired slot
    // open at the same time and observe the peak concurrency.
    const barrier = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });

    const task = () =>
      withBackgroundWriteSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
      });

    // Launch more tasks than the cap; the excess must queue.
    const total = MAX_CONCURRENT_BACKGROUND_WRITES + 2;
    const running = Array.from({ length: total }, task);

    // Only the cap's worth of tasks may hold a slot before we release anything.
    await vi.waitFor(() =>
      expect(active).toBe(MAX_CONCURRENT_BACKGROUND_WRITES)
    );
    expect(peak).toBe(MAX_CONCURRENT_BACKGROUND_WRITES);

    releaseAll();
    await Promise.all(running);

    // The queued tasks drained through, but the cap was never exceeded.
    expect(peak).toBe(MAX_CONCURRENT_BACKGROUND_WRITES);
  });
});
