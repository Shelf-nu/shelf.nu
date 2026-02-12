import { format } from "date-fns";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { getAssetDepreciation } from "~/modules/asset-depreciation/service.server";
import { buildStraightLineSchedule } from "~/modules/asset-depreciation/utils.server";
import { formatValueForCsv } from "~/utils/csv.server";
import { formatCurrency, getCurrencyDecimalDigits } from "~/utils/currency";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

function buildFilename(title: string | null | undefined) {
  const fallback = "asset";
  const source = title && title.trim().length > 0 ? title : fallback;
  const sanitizedTitle = source
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const base = sanitizedTitle.length > 0 ? sanitizedTitle : fallback;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `${base}-depreciation-${timestamp}.csv`;
}

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    const asset = await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
    });

    const depreciation = await getAssetDepreciation({ assetId });
    if (
      !depreciation ||
      asset.valuation === null ||
      asset.valuation === undefined
    ) {
      return new Response("", {
        status: 204,
        headers: {
          "content-type": "text/csv",
          "content-disposition": `attachment; filename="${buildFilename(
            asset.title
          )}"`,
        },
      });
    }

    const currencyDigits = getCurrencyDecimalDigits(
      currentOrganization.currency
    );

    const schedule = buildStraightLineSchedule({
      assetValue: asset.valuation,
      residualValue: depreciation.residualValue ?? 0,
      depreciationRate: depreciation.depreciationRate,
      period: depreciation.period,
      startDate: depreciation.startDate,
      disposedAt: asset.disposedAt ?? null,
      currencyDigits,
    });

    const headers = [
      "Asset ID",
      "Asset Name",
      "Sequential ID",
      "Currency",
      "Period Start",
      "Period End",
      "Days In Period",
      "Depreciation Amount",
      "Accumulated Depreciation",
      "Carrying Amount",
      "Depreciation Rate",
      "Period",
      "Residual Value",
      "Start Date",
      "Disposed At",
    ].map((h) => formatValueForCsv(h));

    const rows = schedule.map((row) => [
      formatValueForCsv(asset.id),
      formatValueForCsv(asset.title),
      formatValueForCsv(asset.sequentialId ?? ""),
      formatValueForCsv(currentOrganization.currency),
      formatValueForCsv(format(row.periodStart, "yyyy-MM-dd")),
      formatValueForCsv(format(row.periodEnd, "yyyy-MM-dd")),
      formatValueForCsv(row.daysInPeriod),
      formatValueForCsv(
        formatCurrency({
          value: row.depreciationAmount,
          locale: "en-US",
          currency: currentOrganization.currency,
        })
      ),
      formatValueForCsv(
        formatCurrency({
          value: row.accumulatedDepreciation,
          locale: "en-US",
          currency: currentOrganization.currency,
        })
      ),
      formatValueForCsv(
        formatCurrency({
          value: row.carryingAmount,
          locale: "en-US",
          currency: currentOrganization.currency,
        })
      ),
      formatValueForCsv(depreciation.depreciationRate),
      formatValueForCsv(depreciation.period),
      formatValueForCsv(depreciation.residualValue ?? 0),
      formatValueForCsv(format(depreciation.startDate, "yyyy-MM-dd")),
      formatValueForCsv(
        asset.disposedAt ? format(asset.disposedAt, "yyyy-MM-dd") : ""
      ),
    ]);

    const csvRows = [headers, ...rows].map((row) => row.join(";"));
    const csvString = csvRows.join("\n");

    return new Response(csvString, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${buildFilename(
          asset.title
        )}"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};
