/**
 * Tests for the build version checker store and its fetcher.
 *
 * @see {@link file://./build-version-checker.ts}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_THROTTLE_MS,
  CHECK_TIMEOUT_MS,
  createBuildVersionChecker,
  fetchServerBuildId,
} from "./build-version-checker";

const OWN_ID = "1700000000000";
const NEWER_ID = "1700000000500";
const NEWEST_ID = "1700000000900";
const OLDER_ID = "1699999999000";

/**
 * Builds a checker with an injected fetcher and a controllable clock.
 *
 * @param answers - Server ids the fetcher resolves with, in call order
 */
function setup(answers: Array<string | null> = [], ownBuildId = OWN_ID) {
  let clock = 1_000_000;
  // why: the server is a network dependency; tests script its answers
  const fetchServerBuildId = vi.fn<() => Promise<string | null>>();
  answers.forEach((answer) => fetchServerBuildId.mockResolvedValueOnce(answer));
  const checker = createBuildVersionChecker({
    ownBuildId,
    fetchServerBuildId,
    now: () => clock,
  });
  return {
    checker,
    fetchServerBuildId,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createBuildVersionChecker", () => {
  it("starts current", () => {
    const { checker } = setup();
    expect(checker.getSnapshot()).toEqual({ status: "current" });
  });

  it("latches when the server runs a newer build", async () => {
    const { checker } = setup([NEWER_ID]);

    await expect(checker.check()).resolves.toBe("newer");
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWER_ID,
    });
  });

  it("keeps the newer state when a later answer comes from an older machine", async () => {
    const { checker } = setup([NEWER_ID, OLDER_ID, OWN_ID]);

    await checker.check();
    await expect(checker.check()).resolves.toBe("older");
    await expect(checker.check()).resolves.toBe("same");
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWER_ID,
    });
  });

  it("moves the latch up to an even newer build", async () => {
    const { checker } = setup([NEWER_ID, NEWEST_ID]);

    await checker.check();
    await checker.check();
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWEST_ID,
    });
  });

  it("does not move the latch down to a build between its own and the latched one", async () => {
    const { checker } = setup([NEWEST_ID, NEWER_ID]);

    await checker.check();
    await expect(checker.check()).resolves.toBe("newer");
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWEST_ID,
    });
  });

  it("stays current when the server runs the same build", async () => {
    const { checker } = setup([OWN_ID]);

    await expect(checker.check()).resolves.toBe("same");
    expect(checker.getSnapshot()).toEqual({ status: "current" });
  });

  it("skips a throttled check within the window and runs one after it", async () => {
    const { checker, fetchServerBuildId, advance } = setup([OWN_ID, NEWER_ID]);

    await expect(checker.checkThrottled()).resolves.toBe("same");
    advance(CHECK_THROTTLE_MS - 1);
    await expect(checker.checkThrottled()).resolves.toBeNull();
    expect(fetchServerBuildId).toHaveBeenCalledTimes(1);

    advance(1);
    await expect(checker.checkThrottled()).resolves.toBe("newer");
    expect(fetchServerBuildId).toHaveBeenCalledTimes(2);
  });

  it("lets check() bypass the throttle", async () => {
    const { checker, fetchServerBuildId } = setup([OWN_ID, NEWER_ID]);

    await checker.checkThrottled();
    await expect(checker.check()).resolves.toBe("newer");
    expect(fetchServerBuildId).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent checks", async () => {
    const { checker, fetchServerBuildId } = setup([NEWER_ID]);

    const [first, second] = await Promise.all([
      checker.check(),
      checker.check(),
    ]);
    expect(first).toBe("newer");
    expect(second).toBe("newer");
    expect(fetchServerBuildId).toHaveBeenCalledTimes(1);
  });

  it("resolves unknown and keeps the state when the fetch fails", async () => {
    const { checker, fetchServerBuildId } = setup([NEWER_ID]);
    await checker.check();
    fetchServerBuildId.mockRejectedValueOnce(new Error("offline"));
    fetchServerBuildId.mockResolvedValueOnce(null);

    await expect(checker.check()).resolves.toBe("unknown");
    await expect(checker.check()).resolves.toBe("unknown");
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWER_ID,
    });
  });

  it("settles a stalled check at the deadline so later checks run again", async () => {
    vi.useFakeTimers();
    try {
      const { checker, fetchServerBuildId } = setup();
      fetchServerBuildId.mockReturnValueOnce(new Promise(() => {}));
      fetchServerBuildId.mockResolvedValueOnce(NEWER_ID);

      const stalled = checker.check();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      await expect(stalled).resolves.toBe("unknown");

      await expect(checker.check()).resolves.toBe("newer");
      expect(fetchServerBuildId).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still latches a newer build that answers after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { checker, fetchServerBuildId } = setup();
      let answer: (id: string) => void = () => {};
      fetchServerBuildId.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        })
      );

      const late = checker.check();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      await expect(late).resolves.toBe("unknown");

      answer(NEWER_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(checker.getSnapshot()).toEqual({
        status: "newer",
        serverBuildId: NEWER_ID,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fetches from a dev build", async () => {
    const { checker, fetchServerBuildId } = setup([NEWER_ID], "dev");

    await expect(checker.check()).resolves.toBe("unknown");
    await expect(checker.checkThrottled()).resolves.toBe("unknown");
    expect(fetchServerBuildId).not.toHaveBeenCalled();
    expect(checker.getSnapshot()).toEqual({ status: "current" });
  });

  it("notifies listeners on a change only, until they unsubscribe", async () => {
    const { checker } = setup([OWN_ID, NEWER_ID, OLDER_ID, NEWEST_ID]);
    const listener = vi.fn();
    const unsubscribe = checker.subscribe(listener);

    await checker.check();
    expect(listener).not.toHaveBeenCalled();
    await checker.check();
    expect(listener).toHaveBeenCalledTimes(1);
    await checker.check();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await checker.check();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(checker.getSnapshot()).toEqual({
      status: "newer",
      serverBuildId: NEWEST_ID,
    });
  });

  it("returns the same snapshot reference while nothing changes", async () => {
    const { checker } = setup([OWN_ID, NEWER_ID, OLDER_ID]);
    const initial = checker.getSnapshot();

    await checker.check();
    expect(checker.getSnapshot()).toBe(initial);

    await checker.check();
    const latched = checker.getSnapshot();
    expect(latched).not.toBe(initial);

    await checker.check();
    expect(checker.getSnapshot()).toBe(latched);
  });
});

describe("fetchServerBuildId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the id from an ok JSON response and asks for an uncached answer", async () => {
    // why: fetch is the network boundary
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ buildId: NEWER_ID }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchServerBuildId()).resolves.toBe(NEWER_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/build-version",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("returns null for a non-ok response", async () => {
    // why: fetch is the network boundary
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503 }))
    );

    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it("aborts a request that stalls past the deadline and returns null", async () => {
    vi.useFakeTimers();
    try {
      // why: fetch is the network boundary; this one only settles on abort
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = fetchServerBuildId();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);

      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null when the request throws", async () => {
    // why: fetch is the network boundary
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(fetchServerBuildId()).resolves.toBeNull();
  });
});
