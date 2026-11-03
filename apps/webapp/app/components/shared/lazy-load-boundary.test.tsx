/**
 * Tests for {@link LazyLoadBoundary}: a lazily loaded feature shows its loading
 * fallback, then itself, and degrades to its failure message when the chunk
 * does not load, without throwing to the page's error boundary.
 *
 * @see {@link file://./lazy-load-boundary.tsx}
 */
import { lazy } from "react";
import * as Sentry from "@sentry/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LazyLoadBoundary } from "./lazy-load-boundary";

// why: Sentry is a network side effect; the test asserts what would be sent.
vi.mock("@sentry/react-router", () => ({ captureException: vi.fn() }));

describe("LazyLoadBoundary", () => {
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

  it("shows the failure message when the loaded component crashes", async () => {
    // why: React logs every error a boundary catches; the crash is expected.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render crash" }),
      { tags: { source: "lazy-load-boundary" } }
    );
    consoleError.mockRestore();
  });

  it("shows the failure message when the chunk does not load", async () => {
    // why: React logs every error a boundary catches; the failure is expected.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const Broken = lazy(() =>
      Promise.reject(new Error("Failed to fetch dynamically imported module"))
    );

    render(
      <div>
        <p>Rest of the page</p>
        <LazyLoadBoundary loading={<p>Loading</p>} failed={<p>Failed</p>}>
          <Broken />
        </LazyLoadBoundary>
      </div>
    );

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Rest of the page")).toBeInTheDocument();
    // The page's error boundary never sees it, so this one reports it.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to fetch dynamically imported module",
      }),
      { tags: { source: "lazy-load-boundary" } }
    );
    consoleError.mockRestore();
  });
});
