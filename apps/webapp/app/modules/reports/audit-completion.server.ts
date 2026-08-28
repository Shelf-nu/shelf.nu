/**
 * Audit Completion Report — Server-Side Data Fetching
 *
 * Builds the Audit Completion report from `AuditSession` directly — the
 * authoritative base table whose counters
 * (`expectedAssetCount`/`foundAssetCount`/`missingAssetCount`/
 * `unexpectedAssetCount`) and lifecycle timestamps the audit service
 * maintains.
 *
 * Lifecycle facts are read from timestamps, never from `status`:
 * - **Completed** means `completedAt IS NOT NULL`. Archiving rewrites
 *   `status` to ARCHIVED (from COMPLETED or CANCELLED) while leaving the
 *   timestamps intact, so a status-based predicate silently drops every
 *   archived session from the metric it belongs to.
 * - **Cancelled** likewise means `cancelledAt IS NOT NULL` — a cancelled
 *   session that is later archived must stay excluded from the totals.
 *
 * Lives in its own module (not `helpers.server.ts`) so the audits category
 * has a seam of its own; the payload shape and query discipline mirror the
 * sibling report helpers.
 *
 * @see {@link file://./types.ts}
 * @see {@link file://./registry.ts}
 * @see {@link file://./helpers.server.ts}
 */

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";

import type {
  AuditCompletionKpiId,
  AuditCompletionRow,
  ReportKpi,
  ReportPayload,
  ResolvedTimeframe,
} from "./types";
import { USER_NAME_SELECT } from "../user/fields";

/** Arguments for {@link auditCompletionReport}. */
interface AuditCompletionArgs {
  organizationId: string;
  /** Window applied to `AuditSession.createdAt` — a session belongs to the
   * period it was created in, regardless of when it finished. */
  timeframe: ResolvedTimeframe;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Audit Completion report.
 *
 * Answers: "Are audits getting done, and what are they finding?" KPIs cover
 * volume (total non-cancelled sessions), throughput (completed sessions and
 * the completion rate), follow-up pressure (overdue sessions), and the
 * headline finding (assets missing across completed sessions). Rows list
 * every session created in the window — cancelled and archived included, so
 * the table reconciles with the audits index — newest first.
 *
 * Orgs without the audits add-on simply have no sessions; the report renders
 * its standard empty state with zero KPIs and a "—" rate.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 * @throws {ShelfError} If any of the underlying queries fail
 */
export async function auditCompletionReport(
  args: AuditCompletionArgs
): Promise<ReportPayload<AuditCompletionRow>> {
  const { organizationId, timeframe, page = 1, pageSize = 50 } = args;

  const startTime = performance.now();

  try {
    const now = new Date();

    // Session-belongs-to-period predicate shared by every query below, so
    // the rows, the pagination total, and each KPI all measure one window.
    const windowWhere = {
      organizationId,
      createdAt: { gte: timeframe.from, lte: timeframe.to },
    };

    const [
      sessions,
      totalRows,
      totalAudits,
      completedAudits,
      overdueAudits,
      missingAggregate,
    ] = await Promise.all([
      db.auditSession.findMany({
        where: windowWhere,
        // `id` tiebreaker keeps skip/take paging deterministic for rows
        // sharing a `createdAt` (bulk creation lands in the same
        // millisecond).
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          status: true,
          expectedAssetCount: true,
          foundAssetCount: true,
          missingAssetCount: true,
          unexpectedAssetCount: true,
          startedAt: true,
          dueDate: true,
          completedAt: true,
          createdBy: { select: USER_NAME_SELECT },
        },
      }),
      // Pagination total: every session in the window, cancelled included,
      // matching what the table lists.
      db.auditSession.count({ where: windowWhere }),
      // Total for the KPI/rate: sessions that were never cancelled.
      // `cancelledAt`, not `status` — archiving a cancelled session
      // rewrites its status to ARCHIVED but keeps the timestamp.
      db.auditSession.count({
        where: { ...windowWhere, cancelledAt: null },
      }),
      // Completed: `completedAt`, not `status` — archiving a completed
      // session rewrites its status to ARCHIVED but keeps the timestamp.
      db.auditSession.count({
        where: { ...windowWhere, completedAt: { not: null } },
      }),
      // Overdue: past due and still open — neither finished nor cancelled.
      db.auditSession.count({
        where: {
          ...windowWhere,
          dueDate: { lt: now },
          completedAt: null,
          cancelledAt: null,
        },
      }),
      // The headline finding: assets missing across completed sessions.
      // Scoped to completed sessions because an in-flight session's
      // missing counter still shrinks as scanning proceeds.
      db.auditSession.aggregate({
        _sum: { missingAssetCount: true },
        where: { ...windowWhere, completedAt: { not: null } },
      }),
    ]);

    const rows: AuditCompletionRow[] = sessions.map((session) => ({
      id: session.id,
      name: session.name,
      status: session.status,
      expectedAssetCount: session.expectedAssetCount,
      foundAssetCount: session.foundAssetCount,
      missingAssetCount: session.missingAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
      // Null when the session expected 0 assets — nothing to be accurate
      // against, and null (not 0%) renders as "—" instead of a failing score.
      accuracy:
        session.expectedAssetCount > 0
          ? Math.round(
              (session.foundAssetCount / session.expectedAssetCount) * 100
            )
          : null,
      createdByName: resolveUserDisplayName(session.createdBy),
      startedAt: session.startedAt,
      dueDate: session.dueDate,
      completedAt: session.completedAt,
    }));

    const kpis = buildAuditCompletionKpis({
      totalAudits,
      completedAudits,
      overdueAudits,
      assetsMissing: missingAggregate._sum.missingAssetCount ?? 0,
    });

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "audit-completion",
        title: "Audit Completion",
        description:
          "Track audit sessions: completion rate, overdue audits, and assets found missing.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Audit Completion report",
      additionalData: { organizationId },
    });
  }
}

/**
 * Assemble the KPI cards from the pre-computed counts.
 *
 * The completion rate follows the null-not-zero convention: with no
 * measurable sessions there is no rate, so the card shows "—" and carries no
 * `rawValue` — 0% would misread as "every audit failed to finish".
 *
 * @param counts - Window-scoped counts computed by the report queries
 * @returns KPI cards in display order
 */
function buildAuditCompletionKpis(counts: {
  totalAudits: number;
  completedAudits: number;
  overdueAudits: number;
  assetsMissing: number;
}): ReportKpi[] {
  const { totalAudits, completedAudits, overdueAudits, assetsMissing } = counts;

  const completionRate =
    totalAudits > 0 ? Math.round((completedAudits / totalAudits) * 100) : null;

  // Explicitly typed so each entry's `id` stays inside the report's KPI union.
  const kpis: Array<ReportKpi & { id: AuditCompletionKpiId }> = [
    {
      id: "total_audits",
      label: "Total Audits",
      value: totalAudits.toLocaleString(),
      rawValue: totalAudits,
      format: "number",
      delta: null,
      deltaType: "neutral",
      description:
        "Audit sessions created in the timeframe, excluding cancelled ones.",
    },
    {
      id: "completed_audits",
      label: "Completed",
      value: completedAudits.toLocaleString(),
      rawValue: completedAudits,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "completion_rate",
      label: "Completion Rate",
      value: completionRate !== null ? `${completionRate}%` : "—",
      ...(completionRate !== null ? { rawValue: completionRate } : {}),
      format: "percent",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "overdue_audits",
      label: "Overdue",
      value: overdueAudits.toLocaleString(),
      rawValue: overdueAudits,
      format: "number",
      delta: null,
      deltaType: "neutral",
      description: "Past their due date and neither completed nor cancelled.",
    },
    {
      id: "assets_missing",
      label: "Assets Missing",
      value: assetsMissing.toLocaleString(),
      rawValue: assetsMissing,
      format: "number",
      delta: null,
      deltaType: "neutral",
      description: "Sum of missing assets across completed audits.",
    },
  ];

  return kpis;
}
