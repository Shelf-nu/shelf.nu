/**
 * Create assets from stock
 *
 * The dialog behind "Create assets from stock" in a quantity-tracked asset's
 * Actions menu. It asks how many units to take out of the pool, from which
 * source when the pool has more than one, an optional asset model and a
 * name, and creates that many individually tracked assets in one step.
 *
 * Needs both `asset: create` (new assets) and `asset: update` (the pool's
 * total goes down).
 *
 * @see {@link file://../../modules/asset/create-from-stock.server.ts}
 * @see {@link file://../../components/assets/actions-dropdown.tsx} - entry point
 */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { CustodySourceSelect } from "~/components/assets/custody-source-select";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import Input from "~/components/forms/input";
import Icon from "~/components/icons/icon";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { MAX_ASSETS_FROM_STOCK } from "~/modules/asset/create-from-stock";
import {
  createAssetsFromStock,
  getAssetsFromStockChoices,
} from "~/modules/asset/create-from-stock.server";
import { defaultAssignSourceOption } from "~/modules/asset/custody-source";
import { getAsset } from "~/modules/asset/service.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { getAssetModels } from "~/modules/asset-model/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { requiredNumberFromString } from "~/utils/zod-numeric";

export const meta = () => [
  { title: appendToMetaTitle("Create assets from stock") },
];

/**
 * Asserts the caller may both create assets and update the pool, counting
 * the workspace's permission switches for each.
 *
 * @returns The caller's context from `requirePermission`
 * @throws {ShelfError} 403 when either permission is missing
 */
async function requireCreateAndUpdate(request: Request, userId: string) {
  const context = await requirePermission({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.create,
  });
  await validatePermission({
    roles: context.userOrganizations.find(
      (o) => o.organization.id === context.organizationId
    )?.roles,
    workspace: context.currentOrganization,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
    organizationId: context.organizationId,
    userId,
  });
  return context;
}

/**
 * Loads the pool, its free units and sources, and the first page of asset
 * models for the picker.
 *
 * @throws {Response} The error payload with its status when the user lacks
 *   a permission or the asset is not in the active organization
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requireCreateAndUpdate(
      request,
      userId
    );

    const asset = await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
    });

    if (!isQuantityTracked(asset)) {
      throw new ShelfError({
        cause: null,
        message:
          "Only quantity-tracked assets have stock to create assets from.",
        additionalData: { assetId },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const [choices, { assetModels, totalAssetModels }] = await Promise.all([
      getAssetsFromStockChoices({
        assetId,
        organizationId,
        total: asset.quantity ?? 0,
      }),
      getAssetModels({ organizationId }),
    ]);

    return payload({
      header: {
        title: "Create assets from stock",
        subHeading:
          "Take units out of this stock and track each one as its own asset.",
      },
      showModal: true,
      asset: {
        id: asset.id,
        title: asset.title,
        unitOfMeasure: asset.unitOfMeasure,
        archivedAt: asset.archivedAt,
      },
      ...choices,
      assetModels,
      totalAssetModels,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

/** The dialog's fields. The service checks every bound again under the lock. */
const CreateAssetsFromStockSchema = z.object({
  count: requiredNumberFromString({ fieldName: "Number of assets" }).pipe(
    z
      .number()
      .int("Enter a whole number")
      .min(1, "Create at least 1 asset")
      .max(
        MAX_ASSETS_FROM_STOCK,
        `Create at most ${MAX_ASSETS_FROM_STOCK} assets at a time`
      )
  ),
  source: z.string().min(1, "Choose where the units come from"),
  title: z.string().trim().min(1, "Name the new assets"),
  assetModelId: z
    .string()
    .optional()
    .transform((value) => value || undefined),
});

/**
 * Creates the assets. One asset opens its page; several return to the pool,
 * whose activity note links all of them.
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requireCreateAndUpdate(request, userId);

    const { count, source, title, assetModelId } = parseData(
      await request.formData(),
      CreateAssetsFromStockSchema
    );

    const { assets } = await createAssetsFromStock({
      poolId: assetId,
      organizationId,
      userId,
      count,
      source,
      title,
      assetModelId,
    });

    sendNotification({
      title:
        assets.length === 1
          ? "Asset created from stock"
          : `${assets.length} assets created from stock`,
      message: "The stock went down by the same number of units.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(
      assets.length === 1 ? `/assets/${assets[0].id}` : `/assets/${assetId}`
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

/**
 * The "Create assets from stock" dialog. The number field's maximum is the
 * smaller of the free units, what the chosen source has left, and
 * {@link MAX_ASSETS_FROM_STOCK}.
 */
export default function CreateAssetsFromStock() {
  const zo = useZorm("CreateAssetsFromStock", CreateAssetsFromStockSchema);
  const { asset, free, options } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const validationErrors = getValidationErrors<
    typeof CreateAssetsFromStockSchema
  >(actionData?.error);
  const isProcessing = isFormProcessing(useNavigation().state);

  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const source =
    options.find((option) => option.value === pickedSource) ??
    defaultAssignSourceOption(options) ??
    options[0] ??
    null;
  const max = Math.min(free, source?.left ?? 0, MAX_ASSETS_FROM_STOCK);
  const unitLabel = asset.unitOfMeasure || "units";
  const isArchived = Boolean(asset.archivedAt);

  const blocked = isArchived
    ? "Reinstate this asset before creating assets from its stock."
    : max < 1
    ? free < 1
      ? `No ${unitLabel} are free: every unit is in custody, in a kit or reserved by a booking.`
      : `${source?.label ?? "This source"} has no free ${unitLabel} left.`
    : null;
  const disabled = isProcessing || isArchived;

  return (
    <Form ref={zo.ref} method="post">
      <div className="modal-content-wrapper">
        <div className="inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <Icon icon="duplicate" />
        </div>
        <Header hideBreadcrumbs classNames="[&>div]:border-b-0" />

        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            {free} {unitLabel} of <strong>{asset.title}</strong> are free. Each
            unit you take out becomes its own asset, and the stock goes down by
            the same number.
          </p>

          {options.length >= 2 ? (
            <CustodySourceSelect
              id={`create-from-stock-source-${asset.id}`}
              label="From location"
              name="source"
              options={options}
              value={source?.value ?? ""}
              onChange={setPickedSource}
              unitLabel={unitLabel}
              disabled={disabled}
            />
          ) : (
            <input type="hidden" name="source" value={source?.value ?? ""} />
          )}

          <Input
            type="number"
            label="Number of assets"
            name={zo.fields.count()}
            defaultValue={1}
            min={1}
            max={Math.max(1, max)}
            step={1}
            className="w-full"
            disabled={disabled || max < 1}
            required
            aria-describedby="create-from-stock-count-hint"
            error={
              validationErrors?.count?.message || zo.errors.count()?.message
            }
          />
          <p
            id="create-from-stock-count-hint"
            className="-mt-3 text-sm text-gray-600"
          >
            Up to {Math.max(0, max)} at a time from this source.
          </p>

          <Input
            label="Name"
            name={zo.fields.title()}
            defaultValue={asset.title}
            className="w-full"
            disabled={disabled}
            required
            aria-describedby="create-from-stock-title-hint"
            error={
              validationErrors?.title?.message || zo.errors.title()?.message
            }
          />
          <p
            id="create-from-stock-title-hint"
            className="-mt-3 text-sm text-gray-600"
          >
            Several assets get a number after the name, starting at 1.
          </p>

          <div className="flex flex-col gap-1">
            <DynamicSelect
              disabled={disabled}
              fieldName="assetModelId"
              model={{ name: "assetModel", queryKey: "name" }}
              triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left"
              placeholder="No model"
              contentLabel="Asset Models"
              label="Asset model (optional)"
              initialDataKey="assetModels"
              countKey="totalAssetModels"
              closeOnSelect
              selectionMode="set"
              allowClear
            />
          </div>

          {blocked ? (
            <p
              id="create-from-stock-blocked"
              className="w-full rounded border border-warning-300 bg-warning-25 p-4 text-sm text-warning-700"
            >
              {blocked}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            to=".."
            variant="secondary"
            width="full"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            type="submit"
            disabled={disabled || max < 1}
            aria-describedby={blocked ? "create-from-stock-blocked" : undefined}
          >
            {isProcessing ? <Spinner /> : "Create assets"}
          </Button>
        </div>
        {actionData?.error ? (
          <div className="mt-3 text-sm text-error-500">
            <p className="font-medium">{actionData.error.title || ""}</p>
            <p>{actionData.error.message}</p>
          </div>
        ) : null}
      </div>
    </Form>
  );
}
