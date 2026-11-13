/**
 * Lazy Load Boundary
 *
 * Wraps a `React.lazy` component so that a chunk which fails to download (a
 * flaky network, a file from another deploy) degrades to a message in place of
 * that one feature, instead of throwing to the route's error boundary and
 * replacing the whole page. What it catches is still reported to Sentry,
 * since the page's error boundary that would have reported it never sees it.
 *
 * When the failure is a chunk load error, the message comes with a Reload
 * button, and the boundary asks the server which build it runs before
 * reporting. That check also raises the app-wide new-version prompt when a
 * newer build is live. The report waits for the check (bounded by the
 * checker's own deadline), or goes out at `pagehide` if the page unloads
 * first, so a click on Reload never loses it. The report carries a `build` tag: `superseded` when a
 * newer build is live or this tab has already seen one (an expected 404 after
 * a deploy, sent as a warning), `current` when the tab runs the live build (a
 * real failure), `unknown` when the check cannot tell.
 *
 * @see {@link file://./reload-app-button.tsx}
 * @see {@link file://./../../utils/build-version-checker.ts}
 * @see {@link file://./../code-preview/code-preview-dialog.tsx}
 * @see {@link file://./../availability-calendar/availability-calendar.lazy.tsx}
 */
import { Component, Suspense } from "react";
import type { ReactNode } from "react";
import * as Sentry from "@sentry/react-router";
import type { BuildComparison } from "~/utils/build-version";
import { isChunkLoadError } from "~/utils/build-version";
import { getBuildVersionChecker } from "~/utils/build-version-checker";
import { ReloadAppButton } from "./reload-app-button";

/** The `build` tag on a chunk load failure report. */
export type ChunkFailureBuildLabel = "superseded" | "current" | "unknown";

/**
 * Maps the build version check to the `build` tag of a chunk load failure
 * report.
 *
 * The checker's latched state wins over the latest answer: during a rolling
 * deploy a check can reach a machine still on this tab's build after another
 * one already reported a newer build, and the tab is superseded either way.
 *
 * @param comparison - The result of the check made for this failure
 * @param newerBuildSeen - Whether the checker has latched a newer build
 * @returns `superseded` when a newer build is live or was seen, `current`
 * when the tab runs the live build, `unknown` otherwise
 */
export function chunkFailureBuildLabel(
  comparison: BuildComparison,
  newerBuildSeen: boolean
): ChunkFailureBuildLabel {
  if (newerBuildSeen || comparison === "newer") return "superseded";
  if (comparison === "same") return "current";
  return "unknown";
}

/**
 * Reports a chunk load failure once its build is known.
 *
 * The report waits for an immediate build check, whose own deadline bounds
 * the wait. If the page unloads first (the Reload button is on screen
 * meanwhile), it goes out at `pagehide` with what is known by then: Sentry's
 * fetch transport sends with `keepalive`, so a request started there
 * survives the unload. Whichever comes first reports; the other is ignored.
 *
 * @param error - The chunk load error the boundary caught
 */
function reportChunkFailure(error: unknown) {
  const checker = getBuildVersionChecker();
  let reported = false;

  const report = (comparison: BuildComparison) => {
    if (reported) return;
    reported = true;
    window.removeEventListener("pagehide", reportBeforeUnload);
    const build = chunkFailureBuildLabel(
      comparison,
      checker.getSnapshot().status === "newer"
    );
    Sentry.captureException(error, {
      tags: { source: "lazy-load-boundary", chunk_load_error: true, build },
      ...(build === "superseded" ? { level: "warning" as const } : {}),
    });
  };
  const reportBeforeUnload = () => report("unknown");

  window.addEventListener("pagehide", reportBeforeUnload);
  void checker.check().then(report);
}

/** Props for {@link LazyLoadBoundary}. */
type LazyLoadBoundaryProps = {
  /** Shown while the chunk downloads. */
  loading: ReactNode;
  /** Shown if the chunk fails to load or the component crashes. */
  failed: ReactNode;
  children: ReactNode;
};

/** State of {@link LazyErrorBoundary}. */
type LazyErrorBoundaryState = {
  /** Something below threw: a lazy import rejection or a render crash. */
  hasFailed: boolean;
  /** What threw is a chunk load error, which a reload can fix. */
  chunkFailed: boolean;
};

/**
 * Catches the rejection of a lazy import (or a render crash of the component)
 * and renders the `failed` fallback, plus a Reload button for a chunk load
 * error.
 */
class LazyErrorBoundary extends Component<
  { failed: ReactNode; children: ReactNode },
  LazyErrorBoundaryState
> {
  state: LazyErrorBoundaryState = { hasFailed: false, chunkFailed: false };

  static getDerivedStateFromError(error: unknown): LazyErrorBoundaryState {
    return { hasFailed: true, chunkFailed: isChunkLoadError(error) };
  }

  componentDidCatch(error: unknown) {
    // Not tagged as the error boundary, which bypasses the client filters:
    // they apply here as anywhere else.
    if (!isChunkLoadError(error)) {
      Sentry.captureException(error, {
        tags: { source: "lazy-load-boundary" },
      });
      return;
    }

    // The report goes out even if the boundary unmounts meanwhile: nothing
    // in it touches component state.
    reportChunkFailure(error);
  }

  render() {
    if (!this.state.hasFailed) return this.props.children;
    if (!this.state.chunkFailed) return this.props.failed;

    return (
      <div className="flex flex-col items-center gap-2">
        {this.props.failed}
        <ReloadAppButton className="items-center text-center" />
      </div>
    );
  }
}

/**
 * Suspense plus an error boundary for one lazily loaded feature.
 *
 * @param props - The loading and failed fallbacks, and the lazy component
 * @returns The component once loaded, a fallback until then or on failure
 */
export function LazyLoadBoundary({
  loading,
  failed,
  children,
}: LazyLoadBoundaryProps) {
  return (
    <LazyErrorBoundary failed={failed}>
      <Suspense fallback={loading}>{children}</Suspense>
    </LazyErrorBoundary>
  );
}
