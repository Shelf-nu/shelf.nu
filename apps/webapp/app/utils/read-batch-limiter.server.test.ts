// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  composeAbort,
  MAX_READ_CONCURRENCY,
  withReadSlot,
  type ReadLane,
} from "./read-batch-limiter.server";

describe("withReadSlot", () => {
  it("never runs more than MAX_READ_CONCURRENCY jobs at once", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll!: () => void;
    // All jobs park on this shared barrier so every acquired slot can be held
    // open at the same time and the peak concurrency observed.
    const barrier = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });

    const job = () =>
      withReadSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
      });

    // Launch more jobs than the cap; the excess must queue.
    const total = 12;
    const running = Array.from({ length: total }, job);

    // Only the cap's worth of jobs may hold a slot before anything is released.
    await vi.waitFor(() => expect(active).toBe(MAX_READ_CONCURRENCY));
    expect(peak).toBe(MAX_READ_CONCURRENCY);

    releaseAll();
    await Promise.all(running);

    // The queued jobs drained through, but the cap was never exceeded.
    expect(peak).toBe(MAX_READ_CONCURRENCY);
  });

  it("removes a job from the queue and rejects with AbortError if its signal aborts before it starts, without ever calling fn", async () => {
    let releaseAll!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });

    // Saturate every slot with long-running jobs that hold their slot open
    // until the barrier is released below. withReadSlot pumps synchronously
    // on enqueue, so all MAX_READ_CONCURRENCY calls have already claimed
    // their slot by the time Array.from returns — no slot is free for the
    // job queued next.
    const saturating = Array.from({ length: MAX_READ_CONCURRENCY }, () =>
      withReadSlot(() => barrier)
    );

    const spy = vi.fn(() => Promise.resolve("should never run"));
    const controller = new AbortController();
    const queuedPromise = withReadSlot(spy, { signal: controller.signal });

    controller.abort();

    await expect(queuedPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).not.toHaveBeenCalled();

    releaseAll();
    await Promise.all(saturating);
  });

  it("rejects immediately with AbortError and never calls fn when given an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi.fn(() => Promise.resolve("should never run"));

    await expect(
      withReadSlot(spy, { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("lets an already-started job run to completion even if its signal aborts", async () => {
    let resolveJob!: (value: string) => void;
    const jobPromise = new Promise<string>((resolve) => {
      resolveJob = resolve;
    });
    const controller = new AbortController();

    // Concurrency is free, so withReadSlot dequeues and calls fn synchronously
    // before this call returns — the job has already started below.
    const result = withReadSlot(() => jobPromise, {
      signal: controller.signal,
    });

    // Aborting a running job's signal must be a no-op: an in-flight query
    // cannot be cancelled, so it keeps its slot and settles normally.
    controller.abort();

    resolveJob("done");
    await expect(result).resolves.toBe("done");
  });

  describe("fairness between lanes", () => {
    /**
     * Verifies that a single job submitted on `loneLane` is not starved by a
     * deep, continuously non-empty backlog on `streamLane` once every
     * concurrency slot is full: it must win one of the first few contested
     * dequeues, not merely "eventually" once the whole backlog has drained.
     *
     * The backlog stands in for an unbroken stream of `streamLane` submissions:
     * what matters for the alternation policy is that `streamLane`'s queue
     * never goes empty while slots are freed one at a time below, which a
     * sufficiently deep backlog guarantees just as a live stream would.
     */
    async function assertLoneJobIsNotStarved(
      loneLane: ReadLane,
      streamLane: ReadLane
    ): Promise<void> {
      const startedCount: Record<ReadLane, number> = {
        interactive: 0,
        export: 0,
      };
      const pendingResolvers: Array<() => void> = [];

      const makeStreamJob = () =>
        withReadSlot(
          () =>
            new Promise<string>((resolve) => {
              startedCount[streamLane] += 1;
              pendingResolvers.push(() => resolve("stream-done"));
            }),
          { lane: streamLane }
        );

      // Fill every concurrency slot with running stream-lane jobs.
      const running = Array.from(
        { length: MAX_READ_CONCURRENCY },
        makeStreamJob
      );
      await vi.waitFor(() =>
        expect(startedCount[streamLane]).toBe(MAX_READ_CONCURRENCY)
      );

      // Queue a deep backlog behind them, on the same lane.
      const backlog = Array.from({ length: 20 }, makeStreamJob);

      let loneJobRan = false;
      const loneJob = withReadSlot(
        () => {
          loneJobRan = true;
          startedCount[loneLane] += 1;
          return Promise.resolve("lone-done");
        },
        { lane: loneLane }
      );

      // Free one running slot at a time; each free pumps the alternation
      // policy once. The lone job must win within this many contested
      // dequeues — well above the ~2 the policy guarantees, kept loose so
      // this test is about the fairness policy, not its exact constant.
      const maxSlotFrees = MAX_READ_CONCURRENCY;
      for (let i = 0; i < maxSlotFrees && !loneJobRan; i++) {
        const beforeTotal = startedCount[streamLane] + startedCount[loneLane];
        const resolveOne = pendingResolvers.shift();
        resolveOne?.();
        // eslint-disable-next-line no-await-in-loop -- each iteration depends
        // on the previous slot-free having actually been pumped.
        await vi.waitFor(() => {
          expect(
            startedCount[streamLane] + startedCount[loneLane] > beforeTotal
          ).toBe(true);
        });
      }

      expect(loneJobRan).toBe(true);

      // Drain every remaining stream-lane job — including ones that only
      // start (and push their own resolver into `pendingResolvers`) as a
      // consequence of resolving an earlier one, once its slot-free is
      // pumped. Resolving is asynchronous (settle -> .then -> .finally ->
      // pumpReadQueue -> next job's synchronous start), so a plain
      // synchronous while-loop races that cascade: it drains whatever is
      // CURRENTLY in the array and exits before the next job has had a
      // chance to push its own resolver, leaving the rest permanently queued
      // and `Promise.all` below hanging forever. A macrotask turn (a 0ms
      // timer) is guaranteed by the event-loop ordering to run only after
      // the microtask queue — including that whole cascade — has drained, so
      // waiting one out between resolves is what actually keeps up with it.
      while (pendingResolvers.length > 0) {
        const resolveOne = pendingResolvers.shift();
        resolveOne?.();
        // eslint-disable-next-line no-await-in-loop -- each iteration must
        // observe the previous resolve's cascade before checking for more.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await loneJob;
      await Promise.all([...running, ...backlog]);
    }

    it("does not starve a lone export job under a continuously non-empty interactive lane", async () => {
      await assertLoneJobIsNotStarved("export", "interactive");
    });

    it("does not starve a lone interactive job under a continuously non-empty export lane", async () => {
      await assertLoneJobIsNotStarved("interactive", "export");
    });
  });
});

describe("composeAbort", () => {
  it("aborts the composed signal as soon as any one input signal aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const { signal, dispose } = composeAbort([a.signal, b.signal]);

    expect(signal.aborted).toBe(false);
    b.abort();
    expect(signal.aborted).toBe(true);

    dispose();
  });

  it("is already aborted when given an already-aborted input signal", () => {
    const a = new AbortController();
    a.abort();

    const { signal, dispose } = composeAbort([a.signal]);
    expect(signal.aborted).toBe(true);

    dispose();
  });

  it("aborts after timeoutMs when given a timeout, independent of the input signals", () => {
    vi.useFakeTimers();
    try {
      const { signal, dispose } = composeAbort([], { timeoutMs: 50 });

      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(49);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose() removes listeners, so a later abort of an input has no effect", () => {
    const controller = new AbortController();
    const { signal, dispose } = composeAbort([controller.signal]);

    dispose();
    controller.abort();

    expect(signal.aborted).toBe(false);
  });
});
