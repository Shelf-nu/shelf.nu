/**
 * Route: New Asset Model
 *
 * Full-page form for creating a new asset model. Loads categories for the
 * DynamicSelect, the organisation currency for the valuation prefix, and the
 * custom fields the model can hold a default value for.
 *
 * @see {@link file://./../../components/asset-model/form.tsx}
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import AssetModelForm, {
  AssetModelFormSchema,
} from "~/components/asset-model/form";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  getModelDefaultFieldOptions,
  parseModelDefaultsFromFormData,
  saveAssetModelCustomFieldDefaults,
} from "~/modules/asset-model/defaults.server";
import {
  createAssetModel,
  deleteAssetModel,
  updateAssetModelImage,
} from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
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

    const [{ categories, totalCategories }, modelDefaultFields] =
      await Promise.all([
        getCategoriesForCreateAndEdit({ organizationId, request }),
        getModelDefaultFieldOptions({ organizationId }),
      ]);

    const header = { title };

    return payload({
      header,
      categories,
      totalCategories,
      currency: currentOrganization?.currency,
      modelDefaultFields,
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

    /**
     * The form is multipart (it carries an optional cover image), so the
     * request body has to be read twice: once here for the text fields and
     * once by `updateAssetModelImage`'s streaming file parser. Cloning is the
     * same pattern the kit routes use — a body stream can only be consumed
     * once.
     */
    const clonedRequest = request.clone();

    const formData = await clonedRequest.formData();
    const parsedData = parseData(formData, AssetModelFormSchema, {
      additionalData: { userId, organizationId },
    });

    // Validated before anything is written, so a bad default never leaves a
    // half-created model behind.
    const customFieldDefaults = parseModelDefaultsFromFormData({
      formData,
      fields: await getModelDefaultFieldOptions({ organizationId }),
    });

    const assetModel = await createAssetModel({
      ...parsedData,
      userId: authSession.userId,
      organizationId,
    });

    /**
     * Runs after the create so the defaults and the image are stored under the
     * new model's id. The image upload no-ops when the user didn't pick a file.
     *
     * A failure here (file rejected, storage or signing error) would otherwise
     * leave the model committed while the action reports an error — the user
     * sees "creation failed", retries, and ends up with a duplicate. Roll the
     * row back so the failure the user is told about is the truth.
     */
    try {
      await saveAssetModelCustomFieldDefaults({
        assetModelId: assetModel.id,
        organizationId,
        defaults: customFieldDefaults,
      });
      await updateAssetModelImage({
        request,
        assetModelId: assetModel.id,
        organizationId,
      });
    } catch (cause) {
      /**
       * Best-effort rollback — the original upload failure is what surfaces to
       * the user. But a rollback that ALSO fails leaves an orphaned, imageless
       * model row behind, and swallowing it silently means nobody ever finds
       * out. Log it so the orphan is discoverable.
       */
      await deleteAssetModel({
        id: assetModel.id,
        organizationId,
        userId: authSession.userId,
      }).catch((rollbackCause: unknown) => {
        Logger.error(
          new ShelfError({
            cause: rollbackCause,
            message:
              "Failed to roll back an asset model after its image upload failed — the model row may be orphaned.",
            additionalData: { assetModelId: assetModel.id, organizationId },
            label: "Asset Model",
          })
        );
      });
      throw cause;
    }

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
