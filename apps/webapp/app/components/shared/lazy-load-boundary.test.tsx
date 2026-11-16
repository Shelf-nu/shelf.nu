/**
 * Tests for {@link LazyLoadBoundary}: a lazily loaded feature shows its loading
 * fallback, then itself, and degrades to its failure message when the chunk
 * does not load, without throwing to the page's error boundary. A chunk load
 * error also offers a Reload button and is reported with the build tag the
 * server's build check yields.
 *
 * @see {@link file://./lazy-load-boundary.tsx}
 */
import { lazy } from "react";
import * as Sentry from "@sentry/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildComparison } from "~/utils/build-version";
import type { BuildVersionState } from "~/utils/build-version-checker";
import { chunkFailureBuildLabel, LazyLoadBoundary } from "./lazy-load-boundary";

const { mockCheck, mockGetSnapshot } = vi.hoisted(() => ({
  mockCheck: vi.fn<() => Promise<BuildComparison>>(),
  mockGetSnapshot: vi.fn<() => BuildVersionState>(),
}));

// why: Sentry is a network side effect; the test asserts what would be sent.
vi.mock("@sentry/react-router", () => ({ captureException: vi.fn() }));

// why: the real checker fetches the server's build id; the test controls the
// comparison it answers with.
vi.mock("~/utils/build-version-checker", () => ({
  getBuildVersionChecker: () => ({
    check: mockCheck,
    getSnapshot: mockGetSnapshot,
  }),
}));

// why: the real button reads app-wide jotai state and reloads the window; this
// test covers when the boundary offers it, not what it does.
vi.mock("./reload-app-button", () => ({
  ReloadAppButton: () => <button type="button">Reload</button>,
  UnsavedChangesReloadHint: () => null,
}));

const CHUNK_ERROR_MESSAGE =
  "Failed to fetch dynamically imported module: https://x/file-assets/a.js";

/**
 * Renders a boundary around a lazy component whose import rejects with a
 * chunk load error.
 */
function renderChunkFailure() {
  const Broken = lazy(() => Promise.reject(new TypeError(CHUNK_ERROR_MESSAGE)));
  render(
    <div>
      <p>Rest of the page</p>
      <LazyLoadBoundary loading={<p>Loading</p>} failed={<p>Failed</p>}>
        <Broken />
      </LazyLoadBoundary>
    </div>
  );
}

describe("LazyLoadBoundary", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockReset();
    mockCheck.mockReset();
    mockCheck.mockResolvedValue("unknown");
    mockGetSnapshot.mockReset();
    mockGetSnapshot.mockReturnValue({ status: "current" });
    // why: React logs every error a boundary catches; the failures are expected.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the loading fallback, then the component", async () => {
    const Loaded = lazy(() =>
      Promise.resolve({ default: () => <p>Calendar</p> })
    );

    render(
      <LazyLoadBoundary loading={<p>Loading</p>} failed={<p>Failed</p>}>
        <Loaded />
      </LazyLoadBoundary>
    );

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(await screen.findByText("Calendar")).toBeInTheDocument();
  });

  it("shows only the failure message when the loaded component crashes", async () => {
    function Crashes(): never {
      throw new Error("render crash");
    }
    const Loaded = lazy(() => Promise.resolve({ default: Crashes }));

    render(
      <LazyLoadBoundary loading={<p>Loading</p>} failed={<p>Failed</p>}>
        <Loaded />
      </LazyLoadBoundary>
    );

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reload" })
    ).not.toBeInTheDocument();
    expect(mockCheck).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render crash" }),
      { tags: { source: "lazy-load-boundary" } }
    );
  });

  it("shows the failure message and a Reload button when the chunk does not load", async () => {
    renderChunkFailure();

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByText("Rest of the page")).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalled();
    // The page's error boundary never sees it, so this one reports it.
    await waitFor(() =>
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: CHUNK_ERROR_MESSAGE }),
        {
          tags: {
            source: "lazy-load-boundary",
            chunk_load_error: true,
            build: "unknown",
          },
        }
      )
    );
  });

  it("reports a chunk failure as a superseded-build warning when a newer build is live", async () => {
    mockCheck.mockResolvedValue("newer");
    renderChunkFailure();

    await waitFor(() =>
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: CHUNK_ERROR_MESSAGE }),
        {
          tags: {
            source: "lazy-load-boundary",
            chunk_load_error: true,
            build: "superseded",
          },
          level: "warning",
        }
      )
    );
  });

  it("keeps a chunk failure superseded when the tab already saw a newer build", async () => {
    // A rolling deploy: an earlier check latched a newer build, this one
    // reached a machine still on the tab's build.
    mockGetSnapshot.mockReturnValue({ status: "newer", serverBuildId: "2" });
    mockCheck.mockResolvedValue("same");
    renderChunkFailure();

    await waitFor(() =>
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: CHUNK_ERROR_MESSAGE }),
        {
          tags: {
            source: "lazy-load-boundary",
            chunk_load_error: true,
            build: "superseded",
          },
          level: "warning",
        }
      )
    );
  });

  it("reports a chunk failure on the live build as an error", async () => {
    mockCheck.mockResolvedValue("same");
    renderChunkFailure();

    await waitFor(() =>
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: CHUNK_ERROR_MESSAGE }),
        {
          tags: {
            source: "lazy-load-boundary",
            chunk_load_error: true,
            build: "current",
          },
        }
      )
    );
  });

  it("reports at pagehide when the page unloads before the check answers", async () => {
    mockCheck.mockReturnValue(new Promise<BuildComparison>(() => {}));
    renderChunkFailure();

    expect(await screen.findByText("Reload")).toBeInTheDocument();
    expect(Sentry.captureException).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: CHUNK_ERROR_MESSAGE }),
      {
        tags: {
          source: "lazy-load-boundary",
          chunk_load_error: true,
          build: "unknown",
        },
      }
    );
  });

  it("reports a chunk failure once, whichever of check and pagehide comes first", async () => {
    let answer: (comparison: BuildComparison) => void = () => {};
    mockCheck.mockReturnValue(
      new Promise<BuildComparison>((resolve) => {
        answer = resolve;
      })
    );
    renderChunkFailure();
    expect(await screen.findByText("Reload")).toBeInTheDocument();

    answer("same");
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalled());
    window.dispatchEvent(new Event("pagehide"));

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("chunkFailureBuildLabel", () => {
  it.each<[BuildComparison, string]>([
    ["newer", "superseded"],
    ["same", "current"],
    ["older", "unknown"],
    ["unknown", "unknown"],
  ])("labels %s as %s when no newer build was seen", (comparison, label) => {
    expect(chunkFailureBuildLabel(comparison, false)).toBe(label);
  });

  it.each<BuildComparison>(["newer", "same", "older", "unknown"])(
    "labels %s as superseded once a newer build was seen",
    (comparison) => {
      expect(chunkFailureBuildLabel(comparison, true)).toBe("superseded");
    }
  );
});
