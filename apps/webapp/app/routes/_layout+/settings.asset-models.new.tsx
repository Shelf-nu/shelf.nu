/**
 * Route: New Asset Model
 *
 * Full-page form for creating a new asset model. Loads categories for the
 * DynamicSelect and the organisation currency for the valuation prefix.
 *
 * @see {@link file://./../../components/asset-model/form.tsx}
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import AssetModelForm, {
  AssetModelFormSchema,
} from "~/components/asset-model/form";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import { createAssetModel } from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const title = "New asset model";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.create,
    });

    const { categories, totalCategories } = await getCategoriesForCreateAndEdit(
      {
        organizationId,
        request,
      }
    );

    const header = { title };

    return payload({
      header,
      categories,
      totalCategories,
      currency: currentOrganization?.currency,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.create,
    });

    const parsedData = parseData(
      await request.formData(),
      AssetModelFormSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    const assetModel = await createAssetModel({
      ...parsedData,
      userId: authSession.userId,
      organizationId,
    });

    sendNotification({
      title: "Asset model created",
      message: "Your asset model has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    if (parsedData.preventRedirect === "true") {
      return data(payload({ success: true, assetModel }));
    }

    return redirect("/settings/asset-models");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function NewAssetModel() {
  return <AssetModelForm />;
}
