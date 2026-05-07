---
description: Visual consistency standards for the Reports module
globs:
  [
    "apps/webapp/app/routes/_layout+/reports*.tsx",
    "apps/webapp/app/components/reports/**/*.tsx",
    "apps/webapp/app/modules/reports/**/*.ts",
  ]
---

# Reports Module Styling Standards

This document defines the visual consistency standards for all report components.
Established during the Booking Compliance report implementation (April 2026).

## Key Files

- `apps/webapp/app/routes/_layout+/reports.$reportId.tsx` - Report content components
- `apps/webapp/app/components/reports/timeframe-picker.tsx` - Timeframe picker
- `apps/webapp/app/modules/reports/helpers.server.ts` - Data fetching

## Main Metric Colors

Use semantic colors based on what the metric represents:

| Metric Type                                  | Color Logic                                               |
| -------------------------------------------- | --------------------------------------------------------- |
| Problem indicator (overdue, idle)            | Conditional: `red` (bad) → `yellow` → `green` (good)      |
| Rate/percentage (utilization, compliance)    | Threshold-based: `green` ≥70%, `blue` ≥30%, `yellow` <30% |
| Neutral count (inventory, activity, custody) | `text-gray-900`                                           |

```typescript
// Problem indicator example (Overdue Items)
<span className={tw(
  "text-3xl font-semibold",
  totalOverdue > 0 ? "text-red-600" : "text-green-600"
)}>

// Rate indicator example (Asset Utilization)
<span className={tw(
  "text-3xl font-semibold",
  avgUtilization >= 70 ? "text-green-600" :
  avgUtilization >= 30 ? "text-blue-600" : "text-yellow-600"
)}>

// Neutral count example (Asset Inventory)
<span className="text-3xl font-semibold text-gray-900">
```

## Utilization/Progress Bars

**Brand color, no judgment.** The bar WIDTH shows magnitude - that's expressive.
Color-coded thresholds imply arbitrary good/bad judgment. Use brand color instead.

```typescript
// Correct: brand color, width shows magnitude
<div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
  <div
    className="h-full rounded-full bg-primary-500"
    style={{ width: `${rate}%` }}
  />
</div>
<span className="text-xs font-semibold tabular-nums text-gray-900">{rate}%</span>

// Wrong: threshold colors imply judgment
// rate >= 70 ? "bg-green-500" : rate >= 30 ? "bg-blue-500" : "bg-yellow-500"
```

**Design principles:**

- Data speaks through SIZE and CONTRAST, not good/bad colors
- `tabular-nums` for number alignment
- Bold numbers (`font-semibold` or `font-bold`) for scannability
- Brand color (`primary-500`) for visual interest without judgment

## Duration Badge Colors

Urgency colors only for reports where duration indicates a problem:

| Context | Red (Critical) | Orange (Warning) | Yellow (Caution) | Gray (Info) |
| ------- | -------------- | ---------------- | ---------------- | ----------- |
| Overdue | >7 days        | >3 days          | ≤3 days          | —           |
| Idle    | >90 days       | >60 days         | ≤60 days         | —           |

**Note:** Custody duration has NO urgency colors. Holding an asset for 2 years
is normal if it's an assigned laptop. Duration ≠ problem in custody context.

## Activity Type Badge Colors

Semantic colors for activity types:

```typescript
const colors: Record<string, string> = {
  CREATED: "bg-green-100 text-green-700", // Positive
  UPDATED: "bg-blue-100 text-blue-700", // Change
  CUSTODY_ASSIGNED: "bg-violet-100 text-violet-700", // Assignment
  CUSTODY_RELEASED: "bg-violet-100 text-violet-700", // Assignment
  BOOKING_CHECKED_OUT: "bg-orange-100 text-orange-700", // Departure
  BOOKING_CHECKED_IN: "bg-green-100 text-green-700", // Return
  LOCATION_CHANGED: "bg-blue-100 text-blue-700", // Change
  CATEGORY_CHANGED: "bg-blue-100 text-blue-700", // Change
};
```

## Typography

**IMPORTANT:** Always use Tailwind's standard font-size utilities. Never use hardcoded pixel values like `text-[14px]` or `text-[10px]`.

| Pixel Value | Tailwind Class                  |
| ----------- | ------------------------------- |
| 10px        | `text-xs` (12px - close enough) |
| 12px        | `text-xs`                       |
| 14px        | `text-sm`                       |
| 16px        | `text-base`                     |
| 20px        | `text-xl`                       |

Standard patterns:

- **Section headers:** `text-sm font-semibold text-gray-900`
- **Hero main metric:** `text-3xl font-semibold`
- **Hero secondary label:** `text-xs text-gray-500`
- **Hero secondary value:** `text-lg font-medium text-gray-900`
- **Badge text:** `text-xs font-medium` or `text-xs font-semibold`
- **Subtitle/caption:** `text-xs text-gray-400`

## Spacing Patterns

**Hero sections:**

```typescript
<div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
```

**Table headers:**

```typescript
<div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
```

**Card sections (Distribution breakdown):**

```typescript
// Header
<div className="border-b border-gray-100 px-4 py-3 md:px-6">
// Body
<div className="max-h-[300px] overflow-y-auto p-4 md:p-6">
```

**Secondary stats separator:**

```typescript
<div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
```

## Hero Section Structure

Every report should have a hero section with:

1. Main metric (left side)
2. Supporting stats (right side, separated by border)

```typescript
<div className="rounded border border-gray-200 bg-white">
  <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
    {/* Main metric */}
    <div className="flex items-center gap-4">
      <span className="text-3xl font-semibold text-gray-900">{value}</span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-700">Label</span>
        <span className="text-xs text-gray-500">Subtitle</span>
      </div>
    </div>

    {/* Supporting stats */}
    <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">Stat Label</span>
        <span className="text-lg font-medium text-gray-900">{statValue}</span>
      </div>
    </div>
  </div>
</div>
```

## Table Section Structure

```typescript
<div className="rounded border border-gray-200 bg-white">
  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
    <h3 className="text-sm font-semibold text-gray-900">Section Title</h3>
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {totalRows}
    </span>
  </div>
  <ReportTable ... />
</div>
```

## Timeframe Picker (react-day-picker v9)

Custom styling via CSS variables:

```typescript
const dayPickerStyles = {
  "--rdp-accent-color": "#F97316", // orange-500
  "--rdp-accent-background-color": "#FFF7ED", // orange-50
  "--rdp-day-width": "32px",
  "--rdp-day-height": "32px",
  "--rdp-day_button-width": "32px",
  "--rdp-day_button-height": "32px",
  "--rdp-months-gap": "16px",
  "--rdp-selected-font-weight": "400", // Prevent bold on selected
  "--rdp-range_middle-font-weight": "400",
  fontSize: "13px",
  fontWeight: 400,
} as React.CSSProperties;
```

## Data Fetching (helpers.server.ts)

**Sorting should match filtering:**

- If filtering by due date (`to`), sort by due date
- If filtering by start date (`from`), sort by start date

```typescript
// Booking Compliance: filter and sort by due date
const where = { to: { gte: timeframe.from, lte: timeframe.to } };
const bookings = await db.booking.findMany({
  where,
  orderBy: { to: "desc" }, // Sort matches filter field
});
```

## Compliance Constants

```typescript
// Grace period: 15 minutes for on-time returns
const COMPLIANCE_GRACE_PERIOD_MS = 15 * 60 * 1000;
```

## Distribution Donut Charts

Use `DistributionDonut` for category/location/status breakdowns:

```typescript
import { DistributionDonut } from "~/components/reports";

<DistributionDonut
  title="By Category"
  data={distributionBreakdown.byCategory}
  emptyMessage="No categories defined"
  maxLegendItems={5}
/>
```

**Color palette (harmonious progression):**

- orange → blue → emerald → violet → amber → cyan → rose → lime → indigo → slate

## Bar Charts (Recharts)

Use `BarChart` with `ChartCard` wrapper for time-series data:

```typescript
import { BarChart, ChartCard } from "~/components/reports";

<ChartCard title="Booking Volume by Month">
  <div className="h-64">
    <BarChart
      series={chartSeries}
      layout="vertical"
      radius={4}
      tooltipFormatter={(value) => `${value} bookings`}
    />
  </div>
</ChartCard>
```

**Color:** Uses Shelf's primary orange (#EF6820)

## Conditional Filter Bars

Not all reports should show the timeframe picker:

```typescript
// Reports that use timeframe filtering (show picker)
const timeframeReports = [
  "booking-compliance",
  "top-booked-assets",
  "monthly-booking-trends",
  "asset-utilization",
  "asset-activity",
];

// Snapshot/live reports (hide picker)
const snapshotReports = [
  "overdue-items", // Live state
  "custody-snapshot", // Live state
  "asset-inventory", // Current snapshot
  "distribution", // Current snapshot
];

// Special case: Idle Assets uses threshold selector, not timeframe
// Shows "30 days / 60 days / 90 days" toggle instead
```
