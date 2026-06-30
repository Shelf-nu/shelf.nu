/**
 * Route: Edit Asset Model
 *
 * Full-page form for editing an existing asset model. Loads the asset model,
 * categories for the DynamicSelect, and the organisation currency for the
 * valuation prefix.
 *
 * @see {@link file://./../../components/asset-model/form.tsx}
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import AssetModelForm, {
  AssetModelFormSchema,
} from "~/components/asset-model/form";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  getAssetModel,
  updateAssetModel,
} from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
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

    const [assetModel, { categories, totalCategories }] = await Promise.all([
      getAssetModel({ id, organizationId }),
      getCategoriesForCreateAndEdit({
        organizationId,
        request,
        defaultCategory: undefined,
      }),
    ]);

    const header = { title };

    return payload({
      header,
      assetModel,
      categories,
      totalCategories,
      currency: currentOrganization?.currency,
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
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.update,
    });

    const parsedPayload = parseData(
      await request.formData(),
      AssetModelFormSchema,
      { additionalData: { userId, id, organizationId } }
    );

    await updateAssetModel({
      ...parsedPayload,
      id,
      organizationId,
    });

    sendNotification({
      title: "Asset model updated",
      message: "Your asset model has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect("/settings/asset-models");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

export default function EditAssetModel() {
  const { assetModel } = useLoaderData<typeof loader>();

  return <AssetModelForm assetModel={assetModel} />;
}
