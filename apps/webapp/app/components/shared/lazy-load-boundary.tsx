/**
 * Lazy Load Boundary
 *
 * Wraps a `React.lazy` component so that a chunk which fails to download (a
 * flaky network, a file from another deploy) degrades to a message in place of
 * that one feature, instead of throwing to the route's error boundary and
 * replacing the whole page. What it catches is still reported to Sentry,
 * since the page's error boundary that would have reported it never sees it.
 *
 * @see {@link file://./../code-preview/code-preview-dialog.tsx}
 * @see {@link file://./../availability-calendar/availability-calendar.lazy.tsx}
 */
import { Component, Suspense } from "react";
import type { ReactNode } from "react";
import * as Sentry from "@sentry/react-router";

/** Props for {@link LazyLoadBoundary}. */
type LazyLoadBoundaryProps = {
  /** Shown while the chunk downloads. */
  loading: ReactNode;
  /** Shown if the chunk fails to load or the component crashes. */
  failed: ReactNode;
  children: ReactNode;
};

/**
 * Catches the rejection of a lazy import (or a render crash of the component)
 * and renders the `failed` fallback.
 */
class LazyErrorBoundary extends Component<
  { failed: ReactNode; children: ReactNode },
  { hasFailed: boolean }
> {
  state = { hasFailed: false };

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  componentDidCatch(error: unknown) {
    // Not tagged as the error boundary, which bypasses the client filters:
    // they apply here as anywhere else.
    Sentry.captureException(error, { tags: { source: "lazy-load-boundary" } });
  }

  render() {
    return this.state.hasFailed ? this.props.failed : this.props.children;
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
