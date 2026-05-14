/**
 * Report PDF Data Route
 *
 * Fetches report data for client-side PDF generation.
 * Returns JSON that the client renders as a styled HTML preview,
 * then converts to PDF via react-to-print.
 *
 * @see {@link file://../../components/reports/compliance-report-pdf.tsx}
 */

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { db } from "~/database/db.server";
import {
  resolveTimeframe,
  bookingComplianceReport,
  assetInventoryReport,
  custodySnapshotReport,
} from "~/modules/reports/helpers.server";
import { getReportById } from "~/modules/reports/registry";
import type {
  TimeframePreset,
  ReportPdfMeta,
  CompliancePdfMeta,
  AssetInventoryPdfMeta,
  CustodySnapshotPdfMeta,
} from "~/modules/reports/types";
import { getDateTimeFormat, getLocale } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getParams,
  getCurrentSearchParams,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Format return status for PDF - matches the CSV export format.
 * Shows "On time" or the lateness duration (e.g., "4h 30m late").
 */
function formatReturnStatus(
  isOnTime: boolean,
  latenessMs: number | null
): string {
  if (isOnTime) {
    return "On time";
  }

  if (latenessMs === null) {
    return "Pending";
  }

  const absMs = Math.abs(latenessMs);
  const minutes = Math.floor(absMs / (1000 * 60));
  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const days = Math.floor(absMs / (1000 * 60 * 60 * 24));

  let value: string;
  if (days > 0) {
    const remainingHours = hours % 24;
    value = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    value =
      remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    value = `${minutes}m`;
  }

  return latenessMs > 0 ? `${value} late` : `${value} early`;
}

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const { userId } = context.getSession();
  const { reportId } = getParams(
    params,
    z.object({
      reportId: z.string(),
    }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    // Validate report exists
    const reportDef = getReportById(reportId);
    if (!reportDef) {
      throw new ShelfError({
        cause: null,
        message: `Report "${reportId}" not found`,
        label: "Report",
        status: 404,
      });
    }

    // Parse filters
    const searchParams = getCurrentSearchParams(request);
    const timeframePreset =
      (searchParams.get("timeframe") as TimeframePreset) || "last_30d";
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const timeframe = resolveTimeframe(
      timeframePreset,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    // Get organization info. `currency` is required so PDF monetary values
    // render in the workspace's configured currency rather than a hardcoded "$".
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        imageId: true,
        updatedAt: true,
        currency: true,
      },
    });

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        label: "Organization",
        status: 404,
      });
    }

    // Locale drives number + currency formatting inside the PDF renderer.
    const locale = getLocale(request);

    // Common monetary fields threaded into every pdfMeta variant.
    const monetaryMeta = {
      currency: organization.currency,
      locale,
    };

    // Date formatter - use explicit options to avoid conflict with dateStyle
    // (the utility adds default year/month/day when timeStyle is missing,
    // which is incompatible with dateStyle)
    const dateFormat = getDateTimeFormat(request, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    // Generate report data based on type
    let pdfMeta: ReportPdfMeta;

    switch (reportId) {
      case "booking-compliance": {
        const reportData = await bookingComplianceReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000, // PDF can handle large tables
        });

        const overdueKpi = reportData.kpis.find(
          (k) => k.id === "currently_overdue"
        );

        pdfMeta = {
          ...monetaryMeta,
          reportId,
          reportTitle: reportDef.title,
          reportDescription: reportDef.description,
          organizationName: organization.name,
          organizationImageId: organization.imageId,
          organizationUpdatedAt: organization.updatedAt,
          generatedAt: dateFormat.format(new Date()),
          timeframeLabel: timeframe.label,
          timeframeFrom: dateFormat.format(timeframe.from),
          timeframeTo: dateFormat.format(timeframe.to),
          complianceRate: reportData.complianceData?.rate ?? 0,
          onTimeCount: reportData.complianceData?.onTime ?? 0,
          lateCount: reportData.complianceData?.late ?? 0,
          // Use totalRows from report (includes COMPLETE + OVERDUE) for accurate row count
          totalCount: reportData.totalRows,
          overdueCount: (overdueKpi?.rawValue as number) || 0,
          priorPeriod: reportData.complianceData?.priorPeriod,
          custodianPerformance: (reportData.custodianPerformance ?? [])
            .filter((c) => c.total >= 2)
            .slice(0, 10)
            .map((c) => ({
              custodianName: c.custodianName,
              rate: c.rate,
              onTime: c.onTime,
              late: c.late,
              total: c.total,
            })),
          rows: reportData.rows.map((row) => ({
            bookingId: row.bookingId,
            bookingName: row.bookingName,
            status: row.status,
            custodian: row.custodian,
            assetCount: row.assetCount,
            scheduledStart: dateFormat.format(new Date(row.scheduledStart)),
            scheduledEnd: dateFormat.format(new Date(row.scheduledEnd)),
            isOnTime: row.isOnTime,
            returnStatus: formatReturnStatus(row.isOnTime, row.latenessMs),
          })),
        } satisfies CompliancePdfMeta;
        break;
      }

      case "asset-inventory": {
        const reportData = await assetInventoryReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });

        // Calculate status breakdown
        const statusBreakdown = {
          available: 0,
          inCustody: 0,
          checkedOut: 0,
        };
        let totalValuation = 0;

        for (const row of reportData.rows) {
          if (row.status === "AVAILABLE") statusBreakdown.available++;
          else if (row.status === "IN_CUSTODY") statusBreakdown.inCustody++;
          else if (row.status === "CHECKED_OUT") statusBreakdown.checkedOut++;
          if (row.valuation) totalValuation += row.valuation;
        }

        pdfMeta = {
          ...monetaryMeta,
          reportId: "asset-inventory",
          reportTitle: reportDef.title,
          reportDescription: reportDef.description,
          organizationName: organization.name,
          organizationImageId: organization.imageId,
          organizationUpdatedAt: organization.updatedAt,
          generatedAt: dateFormat.format(new Date()),
          totalCount: reportData.totalRows,
          totalValuation,
          statusBreakdown,
          rows: reportData.rows.map((row) => ({
            assetId: row.assetId,
            assetName: row.assetName,
            status: row.status,
            category: row.category,
            location: row.location,
            custodian: row.custodian,
            valuation: row.valuation,
            qrId: row.qrId,
          })),
        } satisfies AssetInventoryPdfMeta;
        break;
      }

      case "custody-snapshot": {
        const reportData = await custodySnapshotReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });

        // Calculate totals
        const uniqueCustodians = new Set(
          reportData.rows.map((r) => r.custodianName)
        );
        let totalValuation = 0;
        for (const row of reportData.rows) {
          if (row.valuation) totalValuation += row.valuation;
        }

        pdfMeta = {
          ...monetaryMeta,
          reportId: "custody-snapshot",
          reportTitle: reportDef.title,
          reportDescription: reportDef.description,
          organizationName: organization.name,
          organizationImageId: organization.imageId,
          organizationUpdatedAt: organization.updatedAt,
          generatedAt: dateFormat.format(new Date()),
          totalCount: reportData.totalRows,
          totalAssetsInCustody: reportData.totalRows,
          totalCustodians: uniqueCustodians.size,
          totalValuation,
          rows: reportData.rows.map((row) => ({
            assetId: row.assetId,
            assetName: row.assetName,
            category: row.category,
            location: row.location,
            custodianName: row.custodianName,
            assignedAt: dateFormat.format(new Date(row.assignedAt)),
            daysInCustody: row.daysInCustody,
            valuation: row.valuation,
          })),
        } satisfies CustodySnapshotPdfMeta;
        break;
      }

      default:
        throw new ShelfError({
          cause: null,
          message: `PDF export not implemented for report "${reportId}"`,
          label: "Report",
          status: 500,
        });
    }

    return data(payload({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, reportId });
    throw data(error(reason), { status: reason.status });
  }
};
