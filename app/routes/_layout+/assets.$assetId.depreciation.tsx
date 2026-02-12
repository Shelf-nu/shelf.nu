import type { MouseEvent } from "react";
import { useState } from "react";
import { AssetStatus, DepreciationPeriod } from "@prisma/client";
import { format } from "date-fns";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { Table, Td, Th, Tr } from "~/components/table";
import When from "~/components/when/when";
import { disposeAsset, getAsset } from "~/modules/asset/service.server";
import {
  getAssetDepreciation,
  upsertAssetDepreciation,
} from "~/modules/asset-depreciation/service.server";
import { buildStraightLineSchedule } from "~/modules/asset-depreciation/utils.server";
import {
  getPeriodsPerYear,
  getUsefulLifeYears,
} from "~/modules/asset-depreciation/utils.shared";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getCurrencyDecimalDigits, formatCurrency } from "~/utils/currency";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const depreciationSchema = z.object({
  intent: z.literal("save-depreciation"),
  depreciationRate: z
    .string()
    .transform((val) => Number(val))
    .refine((val) => Number.isFinite(val) && val > 0 && val <= 100, {
      message: "Depreciation rate must be between 0 and 100",
    }),
  period: z.nativeEnum(DepreciationPeriod),
  startDate: z.string().min(1, "Start date is required"),
  residualValue: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 0))
    .refine((val) => Number.isFinite(val) && val >= 0, {
      message: "Residual value must be zero or more",
    }),
});

const disposeSchema = z.object({
  intent: z.literal("dispose-asset"),
  disposedAt: z.string().min(1, "Disposed date is required"),
});

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.asset?.title) },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
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
      include: {
        qrCodes: true,
      },
    });

    const depreciation = await getAssetDepreciation({ assetId });
    const currencyDigits = getCurrencyDecimalDigits(
      currentOrganization.currency
    );

    const schedule =
      depreciation && asset.valuation !== null && asset.valuation !== undefined
        ? buildStraightLineSchedule({
            assetValue: asset.valuation,
            residualValue: depreciation.residualValue ?? 0,
            depreciationRate: depreciation.depreciationRate,
            period: depreciation.period,
            startDate: depreciation.startDate,
            disposedAt: asset.disposedAt ?? null,
            currencyDigits,
          })
        : [];

    const today = new Date();
    const accumulatedToDate = schedule
      .filter((row) => row.periodEnd <= today)
      .reduce((sum, row) => sum + row.depreciationAmount, 0);
    const nextPeriod = schedule.find((row) => row.periodEnd > today) || null;

    return payload({
      asset,
      depreciation,
      schedule,
      currency: currentOrganization.currency,
      summary: {
        accumulatedToDate,
        nextPeriod,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "dispose-asset") {
      const { disposedAt } = parseData(formData, disposeSchema);
      await disposeAsset({
        id: assetId,
        organizationId,
        disposedAt: new Date(disposedAt),
      });

      sendNotification({
        title: "Asset disposed",
        message: "This asset is now marked as disposed.",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });

      return redirect(`/assets/${assetId}/depreciation`);
    }

    const { depreciationRate, period, startDate, residualValue } = parseData(
      formData,
      depreciationSchema
    );

    await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
    });

    await upsertAssetDepreciation({
      assetId,
      depreciationRate,
      period,
      startDate: new Date(startDate),
      residualValue,
    });

    sendNotification({
      title: "Depreciation updated",
      message: "Depreciation settings were saved successfully.",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${assetId}/depreciation`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AssetDepreciationRoute() {
  const { asset, depreciation, schedule, currency, summary } =
    useLoaderData<typeof loader>();
  const [isExporting, setIsExporting] = useState(false);

  const nextPeriod = summary.nextPeriod;
  const depreciationRate = depreciation?.depreciationRate ?? "";
  const residualValue = depreciation?.residualValue ?? 0;
  const startDate = depreciation?.startDate
    ? format(new Date(depreciation.startDate), "yyyy-MM-dd")
    : "";

  const handleDownloadCsv = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsExporting(true);
    try {
      const response = await fetch(
        `/assets/${asset.id}/depreciation-export.csv`
      );
      if (!response.ok || response.status === 204) {
        return;
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        return;
      }

      const contentDisposition = response.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
      const filename =
        filenameMatch?.[1] || `asset-depreciation-${Date.now()}.csv`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Depreciation settings</h3>
            <p className="text-sm text-gray-600">
              Straight-line depreciation with proration and IFRS alignment.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={isExporting}
            className="box-shadow-xs inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-[14px] py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500 disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              {isExporting ? <Spinner /> : null}
              Download CSV
            </span>
          </button>
        </div>

        <form method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="intent" value="save-depreciation" />

          <FormRow rowLabel="Depreciation rate (%)" required>
            <Input
              label="Depreciation rate (%)"
              hideLabel
              name="depreciationRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={depreciationRate}
              placeholder="e.g. 20"
              required
            />
          </FormRow>

          <FormRow rowLabel="Period" required>
            <select
              name="period"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              defaultValue={depreciation?.period ?? DepreciationPeriod.MONTHLY}
            >
              <option value={DepreciationPeriod.MONTHLY}>Monthly</option>
              <option value={DepreciationPeriod.QUARTERLY}>Quarterly</option>
              <option value={DepreciationPeriod.ANNUAL}>Annual</option>
            </select>
          </FormRow>

          <FormRow rowLabel="Start date" required>
            <Input
              label="Start date"
              hideLabel
              name="startDate"
              type="date"
              defaultValue={startDate}
              required
            />
          </FormRow>

          <FormRow rowLabel="Residual value">
            <Input
              label="Residual value"
              hideLabel
              name="residualValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={residualValue}
            />
          </FormRow>

          <FormRow rowLabel="Useful life (calculated)">
            <div className="text-sm">
              {depreciationRate
                ? `${getUsefulLifeYears(Number(depreciationRate)).toFixed(
                    2
                  )} years`
                : "—"}
            </div>
          </FormRow>

          <FormRow rowLabel="Periods per year">
            <div className="text-sm">
              {depreciation?.period
                ? getPeriodsPerYear(depreciation.period)
                : 12}
            </div>
          </FormRow>

          <div className="flex justify-end">
            <Button type="submit">Save depreciation</Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Summary</h3>
            <p className="text-sm text-gray-600">
              Carrying amount and upcoming depreciation.
            </p>
          </div>
          <When truthy={asset.status !== AssetStatus.DISPOSED}>
            <form method="post" className="flex items-center gap-3">
              <input type="hidden" name="intent" value="dispose-asset" />
              <Input
                label="Disposed at"
                hideLabel
                name="disposedAt"
                type="date"
                defaultValue={format(new Date(), "yyyy-MM-dd")}
                required
              />
              <Button variant="secondary" type="submit">
                Mark as disposed
              </Button>
            </form>
          </When>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-sm text-gray-600">
              Accumulated depreciation
            </div>
            <div className="text-lg font-semibold">
              {formatCurrency({
                value: summary.accumulatedToDate,
                locale: "en-US",
                currency,
              })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Next period end</div>
            <div className="text-lg font-semibold">
              {nextPeriod ? format(nextPeriod.periodEnd, "yyyy-MM-dd") : "—"}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold">Depreciation schedule</h3>
        <When
          truthy={schedule.length > 0}
          fallback={<p className="text-sm text-gray-600">No schedule yet.</p>}
        >
          <div className="mt-4 overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Period start</Th>
                  <Th>Period end</Th>
                  <Th>Days</Th>
                  <Th>Depreciation</Th>
                  <Th>Accumulated</Th>
                  <Th>Carrying</Th>
                </Tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <Tr
                    key={`${row.periodStart.toISOString()}-${row.periodEnd.toISOString()}`}
                  >
                    <Td>{format(row.periodStart, "yyyy-MM-dd")}</Td>
                    <Td>{format(row.periodEnd, "yyyy-MM-dd")}</Td>
                    <Td>{row.daysInPeriod}</Td>
                    <Td>
                      {formatCurrency({
                        value: row.depreciationAmount,
                        locale: "en-US",
                        currency,
                      })}
                    </Td>
                    <Td>
                      {formatCurrency({
                        value: row.accumulatedDepreciation,
                        locale: "en-US",
                        currency,
                      })}
                    </Td>
                    <Td>
                      {formatCurrency({
                        value: row.carryingAmount,
                        locale: "en-US",
                        currency,
                      })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </When>
      </Card>
    </div>
  );
}
