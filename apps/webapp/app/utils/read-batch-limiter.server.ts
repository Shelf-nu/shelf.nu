/**
 * Process-wide concurrency limiter for advanced-index hydration reads.
 *
 * The advanced asset index streams most columns eagerly and defers the rest
 * (per-row hydration: availability, last-scan, custody, …) as promises the
 * client reads off the turbo-stream. Each deferred promise runs its own DB
 * query. Left unbounded, a single request with a large page of rows — or a
 * burst of concurrent requests — can fan out enough simultaneous queries to
 * drain the Prisma connection pool, the same pool-exhaustion failure mode
 * documented in {@link file://./background-write-limiter.server.ts} for
 * background writes. This module is the read-side counterpart: it caps how
 * many hydration queries run at once, process-wide, and — unlike the write
 * limiter — is abort-aware, because a hydration query that outlives the
 * stream deadline in {@link file://../modules/asset/advanced-index/deadlines.ts}
 * is orphaned work: nothing will ever read its result.
 *
 * A queued job is cancellable (removed from the queue, promise rejects) right
 * up until it starts running. Once started it holds its slot to completion —
 * an in-flight DB query cannot be cancelled out from under Prisma, so racing
 * it against an abort would free the logical slot while the connection stayed
 * held, defeating the cap (the same trade-off the write limiter documents).
 *
 * Fairness: jobs are split into two lanes ({@link ReadLane}) and the queue is
 * serviced by strict alternation between lanes whenever both have pending
 * work (round-robin), falling through to whichever lane is non-empty when the
 * other is idle. This is deliberately NOT interactive-first — an unbroken
 * stream of interactive jobs must not starve a lone export job (or vice
 * versa): the alternation bounds how many dequeues a job at the front of its
 * lane can be passed over.
 */

/**
 * Fairness lane a read job competes in. `"interactive"` is the default,
 * user-facing lane (a browser waiting on the index page); `"export"` is a
 * bulk/background hydration path (e.g. CSV export). See the module doc for
 * how the two lanes share the concurrency budget.
 */
export type ReadLane = "interactive" | "export";

/** Max hydration queries running concurrently per process. Tuned later by load test. */
export const MAX_READ_CONCURRENCY = 4;

/**
 * One caller waiting for a read slot: either queued (not yet started) or
 * already running and holding a slot.
 */
interface QueuedReadJob {
  /** Which fairness lane this job was submitted under. */
  readonly lane: ReadLane;
  /** Metadata for later metrics (which hydration batch this belongs to). Not read by the scheduler itself. */
  readonly batch: string | undefined;
  /** Metadata for later metrics (how many ids this query hydrates). Not read by the scheduler itself. */
  readonly idCount: number | undefined;
  /**
   * Detaches this job's `abort` listener. Called the moment the job is
   * dequeued to run (so a later abort of its signal is a no-op, per the
   * "running job keeps its slot" rule) or when it settles without ever
   * running.
   */
  detachAbortListener: () => void;
  /** Invoked once a concurrency slot is free. Runs the caller's `fn` and settles its promise. */
  run: () => void;
}

/** In-flight read jobs (0..MAX_READ_CONCURRENCY), across both lanes. */
let activeReadCount = 0;

/** Per-lane FIFO queues of jobs waiting for a slot. */
const laneQueues: Record<ReadLane, QueuedReadJob[]> = {
  interactive: [],
  export: [],
};

/** Lane served by the most recent contested dequeue, so alternation can pick the other lane next. */
let lastServedLane: ReadLane | null = null;

/**
 * Builds the rejection reason used for both an already-aborted signal and a
 * signal that aborts while its job is still queued. Named `AbortError` (via
 * `DOMException`) to match the fetch/AbortController convention the rest of
 * the codebase's `isAbortError` check relies on.
 */
function createReadAbortError(): DOMException {
  return new DOMException(
    "Read slot request aborted before it started",
    "AbortError"
  );
}

/**
 * Picks and removes the next job to run, honoring the lane-alternation
 * fairness policy: when both lanes have pending work the lane opposite the
 * last one served goes next; when only one lane has work, it goes regardless
 * of whose turn it "would" be, since skipping it would waste a free slot.
 *
 * @returns The next job to run, or `undefined` if both lanes are empty.
 */
function dequeueNextReadJob(): QueuedReadJob | undefined {
  const interactiveHasWork = laneQueues.interactive.length > 0;
  const exportHasWork = laneQueues.export.length > 0;

  if (interactiveHasWork && exportHasWork) {
    const lane: ReadLane =
      lastServedLane === "interactive" ? "export" : "interactive";
    lastServedLane = lane;
    return laneQueues[lane].shift();
  }
  if (interactiveHasWork) {
    lastServedLane = "interactive";
    return laneQueues.interactive.shift();
  }
  if (exportHasWork) {
    lastServedLane = "export";
    return laneQueues.export.shift();
  }
  return undefined;
}

/**
 * Starts as many queued jobs as there is free concurrency for. Called any
 * time capacity might have changed: after a job settles, and right after a
 * new job is enqueued (so an immediately-available slot isn't left idle).
 */
function pumpReadQueue(): void {
  while (activeReadCount < MAX_READ_CONCURRENCY) {
    const job = dequeueNextReadJob();
    if (!job) {
      return;
    }
    activeReadCount += 1;
    job.detachAbortListener();
    job.run();
  }
}

/**
 * Runs `fn` once a read concurrency slot is free, under the shared
 * process-wide budget.
 *
 * - If `signal` is already aborted, or aborts while this job is still queued,
 *   the job is removed from the queue and the returned promise rejects with
 *   an `AbortError` — `fn` is never called.
 * - Once `fn` has started it runs to completion and holds its slot until it
 *   settles, even if `signal` aborts meanwhile (an in-flight DB query cannot
 *   be cancelled).
 * - `lane` defaults to `"interactive"`. See the module doc for the fairness
 *   policy between lanes.
 * - `batch`/`idCount` are stored as metadata for later metrics; they have no
 *   effect on scheduling.
 *
 * @param fn - The read to run once a slot is available.
 * @param opts.signal - Aborts the queued (not yet started) job.
 * @param opts.lane - Fairness lane this job competes in.
 * @param opts.batch - Metrics label for the hydration batch this belongs to.
 * @param opts.idCount - Metrics label for how many ids this query hydrates.
 * @returns A promise for `fn`'s resolved value, or an `AbortError` rejection
 *   if the job was aborted before it started.
 */
export function withReadSlot<T>(
  fn: () => Promise<T>,
  opts: {
    signal?: AbortSignal;
    lane?: ReadLane;
    batch?: string;
    idCount?: number;
  } = {}
): Promise<T> {
  const lane = opts.lane ?? "interactive";
  const { signal } = opts;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createReadAbortError());
      return;
    }

    // Reassigned below once the abort listener (if any) is attached, so
    // `detachAbortListener` always has something safe to call.
    let detach: () => void = () => {};

    const job: QueuedReadJob = {
      lane,
      batch: opts.batch,
      idCount: opts.idCount,
      detachAbortListener: () => detach(),
      run: () => {
        void fn()
          .then(resolve, reject)
          .finally(() => {
            activeReadCount -= 1;
            pumpReadQueue();
          });
      },
    };

    laneQueues[lane].push(job);

    if (signal) {
      const onAbort = () => {
        const queue = laneQueues[lane];
        const index = queue.indexOf(job);
        if (index === -1) {
          // Already dequeued (running or settled) — the "running job keeps
          // its slot" rule means an abort here is a no-op.
          return;
        }
        queue.splice(index, 1);
        reject(createReadAbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      detach = () => signal.removeEventListener("abort", onAbort);
    }

    pumpReadQueue();
  });
}

/**
 * Composes multiple `AbortSignal`s (and, optionally, a timeout) into one
 * signal that aborts as soon as ANY input does.
 *
 * Used to combine a request's own abort signal with the hydration deadline
 * ({@link file://../modules/asset/advanced-index/deadlines.ts}
 * `HYDRATION_DEADLINE_MS`) into the single signal passed to
 * {@link withReadSlot}.
 *
 * @param signals - Input signals; the composed signal aborts when any one of
 *   them does (immediately, if one is already aborted when this is called).
 * @param opts.timeoutMs - When given, the composed signal also aborts after
 *   this many ms, independent of the input signals.
 * @returns `signal` — the composed signal — and `dispose`, which removes all
 *   listeners this call attached. Call `dispose` once the composed signal is
 *   no longer needed, to avoid leaking listeners on long-lived input signals.
 */
export function composeAbort(
  signals: AbortSignal[],
  opts?: { timeoutMs?: number }
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const attachedListeners: Array<{
    target: AbortSignal;
    listener: () => void;
  }> = [];
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortComposed = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const input of signals) {
    if (input.aborted) {
      abortComposed();
      continue;
    }
    const listener = () => abortComposed();
    input.addEventListener("abort", listener, { once: true });
    attachedListeners.push({ target: input, listener });
  }

  if (opts?.timeoutMs !== undefined) {
    timeoutId = setTimeout(abortComposed, opts.timeoutMs);
  }

  const dispose = () => {
    for (const { target, listener } of attachedListeners) {
      target.removeEventListener("abort", listener);
    }
    attachedListeners.length = 0;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return { signal: controller.signal, dispose };
}
