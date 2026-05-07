/**
 * Lazy-Loaded Chart Components
 *
 * Wraps recharts-based charts with React.lazy() for code splitting.
 * Reduces initial bundle size by ~30kb by loading recharts on demand.
 *
 * Usage:
 * ```tsx
 * import { LazyAreaChart, LazyBarChart } from "~/components/reports/charts.lazy";
 *
 * <Suspense fallback={<ChartSkeleton />}>
 *   <LazyBarChart series={series} />
 * </Suspense>
 * ```
 *
 * @see {@link https://react.dev/reference/react/lazy}
 */

import { lazy, Suspense } from "react";
import type { AreaChartProps } from "./area-chart";
import type { BarChartProps } from "./bar-chart";

/**
 * Loading placeholder for charts.
 * Shown while recharts is being loaded.
 */
function ChartLoadingFallback() {
  return (
    <div className="flex size-full items-center justify-center">
      <div className="animate-spin size-6 rounded-full border-2 border-gray-200 border-t-gray-900" />
    </div>
  );
}

// Lazy load the chart components
const LazyAreaChartInner = lazy(() =>
  import("./area-chart").then((module) => ({ default: module.AreaChart }))
);

const LazyBarChartInner = lazy(() =>
  import("./bar-chart").then((module) => ({ default: module.BarChart }))
);

/**
 * Lazy-loaded Area Chart with built-in Suspense.
 * Use this in production for better initial load performance.
 */
export function LazyAreaChart(props: AreaChartProps) {
  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyAreaChartInner {...props} />
    </Suspense>
  );
}

/**
 * Lazy-loaded Bar Chart with built-in Suspense.
 * Use this in production for better initial load performance.
 */
export function LazyBarChart(props: BarChartProps) {
  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyBarChartInner {...props} />
    </Suspense>
  );
}

export default { LazyAreaChart, LazyBarChart };
