/**
 * Build Version Checker
 *
 * Framework-free client store that asks the server which build it runs and
 * remembers when a newer one is live. React components read it through
 * `useSyncExternalStore`; plain code (such as an error boundary class) calls
 * `check()` directly.
 *
 * Once a newer build is seen the state latches: it never returns to
 * `current`, and only moves up to an even newer server id. During a rolling
 * deploy consecutive requests can reach machines on different builds, so an
 * "older" or "same" answer after a "newer" one is expected and must not hide
 * the prompt again.
 *
 * The checker only reports. It never reloads or navigates; the UI decides.
 *
 * @see {@link file://./build-version.ts} - id comparison and response parsing
 * @see {@link file://./../../server/build-version.ts} - the endpoint it polls
 */
import type { BuildComparison } from "./build-version";
import {
  BUILD_VERSION_PATH,
  compareBuildIds,
  getOwnBuildId,
  parseBuildVersionResponse,
} from "./build-version";

/** What the tab knows about the server's build. */
export type BuildVersionState =
  | { status: "current" }
  | { status: "newer"; serverBuildId: string };

/** Minimum gap between two throttled checks, in milliseconds. */
export const CHECK_THROTTLE_MS = 60_000;

/**
 * Longest a single check waits for the server, in milliseconds. The request
 * is aborted and the check answers `unknown` once it passes.
 */
export const CHECK_TIMEOUT_MS = 10_000;

/** Options for `createBuildVersionChecker`. */
export type BuildVersionCheckerOptions = {
  /** Build id of the running bundle. A non-digit id (such as "dev") disables checks. */
  ownBuildId: string;
  /** Fetches the server's build id; resolves `null` when it cannot be read. */
  fetchServerBuildId: () => Promise<string | null>;
  /** Clock in milliseconds, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
};

/** The store returned by `createBuildVersionChecker`. */
export type BuildVersionChecker = {
  /** Current state. The same object reference until the state changes. */
  getSnapshot(): BuildVersionState;
  /**
   * Registers a listener called after every state change.
   *
   * @returns A function that removes the listener
   */
  subscribe(listener: () => void): () => void;
  /**
   * Asks the server for its build id now. Concurrent calls share one request.
   *
   * @returns How the server's build compares with the tab's; `unknown` when
   * the request fails or the ids cannot be compared. Never rejects.
   */
  check(): Promise<BuildComparison>;
  /**
   * Runs `check()` unless one started less than `CHECK_THROTTLE_MS` ago.
   *
   * @returns The comparison, or `null` when the call was throttled
   */
  checkThrottled(): Promise<BuildComparison | null>;
};

const CURRENT_STATE: BuildVersionState = { status: "current" };

/**
 * Creates a build version store.
 *
 * @param options - The tab's own build id, the fetcher and an optional clock
 * @returns The store
 */
export function createBuildVersionChecker({
  ownBuildId,
  fetchServerBuildId,
  now = Date.now,
}: BuildVersionCheckerOptions): BuildVersionChecker {
  let state: BuildVersionState = CURRENT_STATE;
  let inFlight: Promise<BuildComparison> | null = null;
  /** Start time of the last check, or `null` before the first one. */
  let lastCheckStartedAt: number | null = null;
  const listeners = new Set<() => void>();

  /** A dev or malformed own id never compares, so there is nothing to fetch. */
  const canCompare = compareBuildIds(ownBuildId, ownBuildId) === "same";

  function setState(next: BuildVersionState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  /** Latches a newer server id, moving the latch only further up. */
  function recordNewer(serverBuildId: string) {
    if (
      state.status === "newer" &&
      compareBuildIds(state.serverBuildId, serverBuildId) !== "newer"
    ) {
      return;
    }
    setState({ status: "newer", serverBuildId });
  }

  async function runCheck(): Promise<BuildComparison> {
    let serverBuildId: string | null;
    try {
      serverBuildId = await fetchServerBuildId();
    } catch {
      return "unknown";
    }
    if (serverBuildId === null) return "unknown";

    const comparison = compareBuildIds(ownBuildId, serverBuildId);
    if (comparison === "newer") recordNewer(serverBuildId);
    return comparison;
  }

  function check(): Promise<BuildComparison> {
    if (!canCompare) return Promise.resolve("unknown");
    if (inFlight) return inFlight;

    lastCheckStartedAt = now();
    // The deadline settles a check whose request stalls, so `inFlight` always
    // clears and later checks can run. A late answer still latches a newer
    // build through `runCheck`; only its return value is dropped.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<BuildComparison>((resolve) => {
      timer = setTimeout(() => resolve("unknown"), CHECK_TIMEOUT_MS);
    });
    inFlight = Promise.race([runCheck(), deadline]).finally(() => {
      clearTimeout(timer);
      inFlight = null;
    });
    return inFlight;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    checkThrottled() {
      if (
        lastCheckStartedAt !== null &&
        now() - lastCheckStartedAt < CHECK_THROTTLE_MS
      ) {
        return Promise.resolve(null);
      }
      return check();
    },
  };
}

/**
 * Fetches the server's build id from `BUILD_VERSION_PATH`.
 *
 * `no-store` keeps the browser and any proxy from answering with a cached id.
 * The request and the body read are aborted after `CHECK_TIMEOUT_MS`, so a
 * stalled connection is released. `AbortController` with `setTimeout`
 * rather than `AbortSignal.timeout()`, which is newer than the supported
 * browser floor.
 *
 * @returns The server's build id, or `null` on a network error, a timeout, a
 * non-2xx status or an unexpected body. Never rejects.
 */
export async function fetchServerBuildId(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(BUILD_VERSION_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseBuildVersionResponse(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let singleton: BuildVersionChecker | null = null;

/**
 * Returns the app-wide checker, created on first use with this bundle's build
 * id and the real fetcher. Safe to call during SSR: nothing touches the
 * network or `window` until a check runs.
 *
 * @returns The shared checker
 */
export function getBuildVersionChecker(): BuildVersionChecker {
  singleton ??= createBuildVersionChecker({
    ownBuildId: getOwnBuildId(),
    fetchServerBuildId,
  });
  return singleton;
}
