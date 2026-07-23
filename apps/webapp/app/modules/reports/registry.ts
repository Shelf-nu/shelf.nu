/**
 * Reports Registry
 *
 * Single source of truth for all available reports. Each report is defined
 * with its metadata, supported filters, and capabilities. The registry is
 * consumed by:
 * - Reports index page (to render the grid of available reports)
 * - Report runner (to validate reportId and load configuration)
 * - Export endpoint (to validate export requests)
 *
 * @see {@link file://./types.ts}
 * @see {@link file://../../routes/_layout+/reports._index.tsx}
 */

import type { ReportDefinition } from "./types";

/**
 * All available reports. Order determines display order in the reports index.
 *
 * Reports are grouped by category:
 * - overview: Cross-cutting reports (inventory snapshots, distributions)
 * - bookings: Booking lifecycle and compliance
 * - assets: Asset-specific activity and utilization
 * - custody: Custody tracking and history
 * - audits: Audit completion and compliance
 */
export const REPORTS: ReportDefinition[] = [
  // -------------------------------------------------------------------------
  // Booking Reports
  // -------------------------------------------------------------------------
  {
    id: "booking-compliance",
    title: "Conformidade de Reservas",
    description:
      "Track booking lifecycle compliance: on-time checkouts, late returns, and overdue items.",
    category: "bookings",
    icon: "ClipboardCheck",
    enabled: true, // R2 — the first report we're building
    filters: [
      { type: "status", label: "Status", multi: true },
      { type: "team_member", label: "Responsável", multi: false },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: true,
    exportable: true,
  },
  {
    id: "top-booked-assets",
    title: "Equipamentos Mais Reservados",
    description:
      "Identify your most frequently booked assets and their utilization patterns.",
    category: "bookings",
    icon: "TrendingUp",
    enabled: true, // R3
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: true,
    exportable: true,
  },
  {
    id: "top-booked-kits",
    title: "Kits Mais Reservados",
    description:
      "Identify your most frequently booked kits and their utilization patterns.",
    category: "bookings",
    icon: "Boxes",
    enabled: true,
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: false,
    exportable: true,
  },
  {
    id: "monthly-booking-trends",
    title: "Tendências Mensais de Reservas",
    description:
      "Visualize booking volume trends over time with month-over-month comparisons.",
    category: "bookings",
    icon: "BarChart3",
    enabled: true, // R9
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: true,
    exportable: true, // Monthly breakdown table can be exported
  },
  {
    id: "overdue-items",
    title: "Itens Atrasados",
    description:
      "Live view of all currently overdue bookings requiring immediate attention.",
    category: "bookings",
    icon: "AlertTriangle",
    enabled: true, // R6
    filters: [
      { type: "team_member", label: "Responsável", multi: false },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: false,
    exportable: true,
  },

  // -------------------------------------------------------------------------
  // Asset Reports
  // -------------------------------------------------------------------------
  {
    id: "asset-inventory",
    title: "Inventário de Equipamentos",
    description:
      "Complete snapshot of your asset inventory with filtering and export capabilities.",
    category: "assets",
    icon: "Package",
    enabled: true, // R1
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: true },
      { type: "status", label: "Status", multi: true },
    ],
    hasChart: false,
    exportable: true,
  },
  {
    id: "asset-activity",
    title: "Asset Activity Summary",
    description:
      "Comprehensive activity history for all assets including changes, custody, and bookings.",
    category: "assets",
    icon: "Activity",
    enabled: true, // R7
    filters: [
      { type: "asset", label: "Equipamento", multi: false },
      { type: "category", label: "Categoria", multi: true },
    ],
    hasChart: true,
    exportable: true,
  },
  {
    id: "asset-utilization",
    title: "Utilização de Equipamentos",
    description:
      "Measure how effectively assets are being used based on booking and custody time.",
    category: "assets",
    icon: "PieChart",
    enabled: true, // R8
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: true,
    exportable: true,
  },
  {
    id: "idle-assets",
    title: "Equipamentos Ociosos",
    description:
      "Find assets that haven't been booked or checked out recently.",
    category: "assets",
    icon: "Clock",
    enabled: true, // R4
    filters: [
      { type: "category", label: "Categoria", multi: true },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: false,
    exportable: true,
  },
  {
    id: "distribution",
    title: "Distribuição de Equipamentos",
    description:
      "Breakdown of assets by category, location, and status for inventory planning.",
    category: "assets",
    icon: "LayoutGrid",
    enabled: true, // R10
    filters: [],
    hasChart: true,
    exportable: true,
  },

  // -------------------------------------------------------------------------
  // Custody Reports
  // -------------------------------------------------------------------------
  {
    id: "custody-snapshot",
    title: "Instantâneo de Guarda",
    description:
      "Live view of all assets currently in custody and their assigned team members.",
    category: "custody",
    icon: "Users",
    enabled: true, // R5
    filters: [
      { type: "team_member", label: "Team Member", multi: false },
      { type: "location", label: "Local", multi: false },
    ],
    hasChart: false,
    exportable: true,
  },
];

/**
 * Get a report definition by ID.
 *
 * @param reportId - The report's unique identifier
 * @returns The report definition, or undefined if not found
 */
export function getReportById(reportId: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === reportId);
}

/**
 * Get all enabled reports.
 *
 * @returns Array of reports that are currently enabled
 */
export function getEnabledReports(): ReportDefinition[] {
  return REPORTS.filter((r) => r.enabled);
}

/**
 * Get reports grouped by category.
 *
 * @returns Object with category keys and arrays of reports
 */
export function getReportsByCategory(): Record<string, ReportDefinition[]> {
  return REPORTS.reduce(
    (acc, report) => {
      const category = report.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(report);
      return acc;
    },
    {} as Record<string, ReportDefinition[]>
  );
}

/** Category metadata for display */
export const REPORT_CATEGORIES: Record<
  ReportDefinition["category"],
  { label: string; description: string }
> = {
  overview: {
    label: "Visão geral",
    description: "High-level snapshots and distributions",
  },
  bookings: {
    label: "Reservas",
    description: "Booking lifecycle and compliance tracking",
  },
  assets: {
    label: "Equipamentos",
    description: "Asset activity, utilization, and inventory",
  },
  custody: {
    label: "Guarda",
    description: "Custody assignments and history",
  },
  audits: {
    label: "Auditorias",
    description: "Audit completion and compliance",
  },
};
