/**
 * Reports Module — Barrel Export
 *
 * Public API for the reports module. Server-only helpers are exported from
 * helpers.server.ts directly; this file exports shared types and utilities.
 *
 * @example
 * ```ts
 * // Types (client & server)
 * import type { ReportKpi, TimeframePreset } from "~/modules/reports";
 *
 * // Timeframe utilities (client & server)
 * import { resolveTimeframe } from "~/modules/reports";
 *
 * // Registry (client & server)
 * import { REPORTS, getReportById } from "~/modules/reports";
 *
 * // Server helpers (server only)
 * import { bookingComplianceReport } from "~/modules/reports/helpers.server";
 * ```
 */

// Types
export * from "./types";

// Timeframe utilities (runs on both client and server)
export * from "./timeframe";

// Registry
export * from "./registry";
