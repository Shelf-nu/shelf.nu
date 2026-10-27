/**
 * Route: Edit Asset Model
 *
 * Full-page form for editing an existing asset model. Loads the asset model,
 * categories for the DynamicSelect, the organisation currency for the
 * valuation prefix, the model's custom field defaults, and how many linked
 * assets have empty fields those defaults would fill.
 *
 * The action handles two submissions: the model form itself, and the
 * `fillLinkedAssets` intent from the card above it, which fills the empty
 * fields of the assets already linked to the model.
 *
 * @see {@link file://./../../components/asset-model/form.tsx}
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import AssetModelForm, {
  AssetModelFormSchema,
} from "~/components/asset-model/form";
import { LinkedAssetsFillCard } from "~/components/asset-model/linked-assets-fill-card";
import { db } from "~/database/db.server";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  fillLinkedAssetsFromModel,
  getAssetModelDefaults,
  getLinkedAssetsFillSummary,
  getModelDefaultFieldOptions,
  parseModelDefaultsFromFormData,
  saveAssetModelCustomFieldDefaults,
} from "~/modules/asset-model/defaults.server";
import {
  getAssetModel,
  updateAssetModel,
  updateAssetModelImage,
} from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getLocale } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const title = "Edit asset model";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetModelId: id } = getParams(
    params,
    z.object({ assetModelId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.update,
    });

    const [
      assetModel,
      { categories, totalCategories },
      modelDefaultFields,
      defaults,
    ] = await Promise.all([
      getAssetModel({ id, organizationId }),
      getCategoriesForCreateAndEdit({
        organizationId,
        request,
        defaultCategory: undefined,
      }),
      getModelDefaultFieldOptions({ organizationId }),
      getAssetModelDefaults({ assetModelId: id, organizationId }),
    ]);

    const fillSummary = defaults
      ? await getLinkedAssetsFillSummary({ model: defaults, organizationId })
      : { assetCount: 0, fields: [] };

    const header = { title };

    return payload({
      header,
      assetModel,
      categories,
      totalCategories,
      currency: currentOrganization?.currency,
      modelDefaultFields,
      modelDefaultValues: Object.fromEntries(
        (defaults?.customFieldDefaults ?? []).map((fieldDefault) => [
          fieldDefault.customFieldId,
          fieldDefault.value,
        ])
      ),
      fillSummary,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetModelId: id } = getParams(
    params,
    z.object({ assetModelId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.update,
    });

    /**
     * Multipart form (optional cover image), so clone: the text fields and the
     * streaming file parser each get their own read of the body.
     */
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    if (formData.get("intent") === "fillLinkedAssets") {
      // Filling writes to assets, so it also needs the asset write permission.
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      });

      const { assetsFilled } = await fillLinkedAssetsFromModel({
        assetModelId: id,
        organizationId,
        userId,
        currency: currentOrganization.currency,
        locale: getLocale(request),
      });

      sendNotification({
        title: "Empty fields filled",
        message:
          assetsFilled === 1
            ? "1 asset was filled from this model's defaults."
            : `${assetsFilled} assets were filled from this model's defaults.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return redirect(`/settings/asset-models/${id}/edit`);
    }

    if (formData.has("intent")) {
      throw new ShelfError({
        cause: null,
        message: "Unknown action.",
        additionalData: { userId, id },
        label: "Asset Model",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const parsedPayload = parseData(formData, AssetModelFormSchema, {
      additionalData: { userId, id, organizationId },
    });
    const customFieldDefaults = parseModelDefaultsFromFormData({
      formData,
      fields: await getModelDefaultFieldOptions({ organizationId }),
    });

    /** What the defaults would fill before this save, to compare after it. */
    const fillBefore = await summariseLinkedFill(id, organizationId);

    // The model and its defaults are one change: either both are saved or
    // neither is.
    await db.$transaction(async (tx) => {
      await updateAssetModel({ ...parsedPayload, id, organizationId }, tx);
      await saveAssetModelCustomFieldDefaults(
        { assetModelId: id, organizationId, defaults: customFieldDefaults },
        tx
      );
    });

    /**
     * Stores a newly-picked image and re-points every inheriting asset at it.
     * No-ops when the user didn't pick a file, so a plain Save keeps the
     * current image.
     */
    await updateAssetModelImage({
      request,
      assetModelId: id,
      organizationId,
    });

    sendNotification({
      title: "Asset model updated",
      message: "Your asset model has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    /**
     * Saving defaults changes nothing on assets already in the model. When
     * this save gave the defaults something new to fill on them, stay on this
     * page so the user sees the card that offers it. Otherwise go back to the
     * list as usual, so a user who chose not to fill is not held here.
     */
    const fillAfter = await summariseLinkedFill(id, organizationId);
    const newFill =
      fillAfter.assetCount > 0 &&
      JSON.stringify(fillAfter) !== JSON.stringify(fillBefore);

    return redirect(
      newFill ? `/settings/asset-models/${id}/edit` : "/settings/asset-models"
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * What filling a model's linked assets would change right now.
 *
 * @param assetModelId - The model
 * @param organizationId - Caller's organization
 */
async function summariseLinkedFill(
  assetModelId: string,
  organizationId: string
) {
  const defaults = await getAssetModelDefaults({
    assetModelId,
    organizationId,
  });
  return defaults
    ? getLinkedAssetsFillSummary({ model: defaults, organizationId })
    : { assetCount: 0, fields: [] };
}

export default function EditAssetModel() {
  const { assetModel, fillSummary } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <LinkedAssetsFillCard summary={fillSummary} />
      <AssetModelForm assetModel={assetModel} />
    </div>
  );
}
